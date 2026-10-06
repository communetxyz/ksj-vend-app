import { describe, it, expect } from "vitest";
import { MachineController } from "../src/controller";
import { SimulatedTransport, type Transport } from "../src/transport";
class FixtureTransport implements Transport {
  kind = "bluetooth" as const;
  name = "Fixture";
  profile = "FFC0";
  commands: Uint8Array[] = [];
  receiver?: (b: Uint8Array) => void;
  lost?: () => void;
  opened = false;
  noOpenReply = false;
  rejectHandshake = false;
  zeroBattery = false;
  noInfoReply = false;
  battery = 82;
  powerFlag = 1;
  replyOtherDoor = false;
  async connect(onData: (b: Uint8Array) => void, onDisconnect: () => void) {
    this.receiver = onData;
    this.lost = onDisconnect;
  }
  async write(b: Uint8Array) {
    this.commands.push(b);
    if (b[0] === 0x8e)
      this.receiver?.(
        Uint8Array.of(0xe8, this.rejectHandshake ? 0x0f : 0xf0, 0, 0, 0, 0x8e),
      );
    if (b[0] === 0x66 && b[1] === 0xf0 && !this.noInfoReply)
      this.receiver?.(
        Uint8Array.of(
          0x77,
          1,
          this.powerFlag,
          this.zeroBattery ? 0 : this.battery,
          0x51,
          0x48,
          0x4c,
          0x66,
        ),
      );
    if (b[0] === 0x66 && b[1] === 0xf1)
      this.receiver?.(
        Uint8Array.from([
          0x1e,
          ...Array(12).fill(this.opened ? 0xf0 : 0x0f),
          0x1b,
        ]),
      );
    if (b[0] === 0xff && !this.noOpenReply) {
      const states = Array(12).fill(0x0f);
      states[this.replyOtherDoor ? 5 : b[6] - 1] = 0xf0;
      this.receiver?.(Uint8Array.from([0x1c, ...states, 0x1b]));
    }
  }
  disconnect() {}
}
describe("machine session safety and result semantics", () => {
  it("requires a positive handshake, never just a successful GATT write", async () => {
    const c = new MachineController(25);
    const t = new FixtureTransport();
    t.rejectHandshake = true;
    await expect(c.connect(t)).rejects.toThrow("rejected");
    expect(c.getSnapshot().status).toBe("disconnected");
  });
  it("retains a valid 0% battery", async () => {
    const c = new MachineController(25);
    const t = new FixtureTransport();
    t.zeroBattery = true;
    await c.connect(t);
    expect(c.getSnapshot().info?.battery).toBe(0);
    c.disconnect();
  });
  it("reads a fresh 0% using only the info query and keeps its own timestamp", async () => {
    const c = new MachineController(25);
    const t = new FixtureTransport();
    await c.connect(t);
    const commandCount = t.commands.length;
    t.zeroBattery = true;
    await c.readBattery();
    expect(t.commands.slice(commandCount).map((b) => [...b])).toEqual([
      [0x66, 0xf0, 0xff, 0x77],
    ]);
    expect(c.getSnapshot().info?.battery).toBe(0);
    const batteryReadAt = c.getSnapshot().infoReadAt;
    expect(batteryReadAt).toBeTruthy();
    await c.readDoors();
    expect(c.getSnapshot().infoReadAt).toBe(batteryReadAt);
    c.disconnect();
    expect(c.getSnapshot().info).toBeUndefined();
    expect(c.getSnapshot().infoReadAt).toBeUndefined();
  });
  it.each(["silent", "malformed"])(
    "clears the old battery after a %s response and allows retry",
    async (failure) => {
      const c = new MachineController(25);
      const t = new FixtureTransport();
      await c.connect(t);
      t.noInfoReply = failure === "silent";
      t.battery = 255;
      const query = c.readBattery();
      expect(c.getSnapshot().readingInfo).toBe(true);
      expect(c.getSnapshot().info).toBeUndefined();
      await expect(query).rejects.toThrow("Battery level unavailable");
      expect(c.getSnapshot().infoReadAt).toBeUndefined();
      expect(c.getSnapshot().infoError).toContain("no valid reply");
      expect(c.getSnapshot().busy).toBe(false);
      expect(c.getSnapshot().readingInfo).toBe(false);
      t.noInfoReply = false;
      t.battery = 63;
      await c.readBattery();
      expect(c.getSnapshot().info?.battery).toBe(63);
      expect(c.getSnapshot().infoError).toBeUndefined();
      c.disconnect();
    },
  );
  it("clears stale battery information when a general refresh fails", async () => {
    const c = new MachineController(25);
    const t = new FixtureTransport();
    await c.connect(t);
    t.noInfoReply = true;
    await expect(c.refresh()).rejects.toThrow("no matching reply");
    expect(c.getSnapshot().info).toBeUndefined();
    expect(c.getSnapshot().infoReadAt).toBeUndefined();
    c.disconnect();
  });
  it("preserves an unexpected power flag for the UI to report as unavailable", async () => {
    const c = new MachineController(25);
    const t = new FixtureTransport();
    await c.connect(t);
    t.powerFlag = 0;
    await c.readBattery();
    expect(c.getSnapshot().info?.batteryPowered).toBe(false);
    c.disconnect();
  });
  it("cancels a pending battery query on disconnect without retaining a reading", async () => {
    const c = new MachineController(25);
    const t = new FixtureTransport();
    await c.connect(t);
    t.noInfoReply = true;
    const query = c.readBattery();
    c.disconnect();
    await expect(query).rejects.toThrow("Disconnected");
    expect(c.getSnapshot().info).toBeUndefined();
    expect(c.getSnapshot().infoReadAt).toBeUndefined();
    expect(c.getSnapshot().readingInfo).toBe(false);
    await expect(c.readBattery()).rejects.toThrow("handshake");
  });
  it("opens only after fresh closed state and matching door feedback", async () => {
    const c = new MachineController(25);
    const t = new FixtureTransport();
    await c.connect(t);
    await c.open(2, "pdf");
    expect(t.commands.slice(-2).map((b) => b[0])).toEqual([0x66, 0xff]);
    expect(c.getSnapshot().doors[1]).toBe("open");
    c.disconnect();
  });
  it("does not unlock a door already reported open", async () => {
    const c = new MachineController(25);
    const t = new FixtureTransport();
    await c.connect(t);
    t.opened = true;
    await expect(c.open(1, "pdf")).rejects.toThrow("not confirmed closed");
    expect(t.commands.filter((b) => b[0] === 0xff)).toHaveLength(0);
    c.disconnect();
  });
  it("does not accept a different door opening as success or retry an uncertain write", async () => {
    const c = new MachineController(25);
    const t = new FixtureTransport();
    await c.connect(t);
    t.replyOtherDoor = true;
    await expect(c.open(1, "pdf")).rejects.toThrow("result is unknown");
    expect(t.commands.filter((b) => b[0] === 0xff)).toHaveLength(1);
    c.disconnect();
  });
  it("prevents overlapping unlocks", async () => {
    const c = new MachineController(50);
    const t = new FixtureTransport();
    await c.connect(t);
    t.noOpenReply = true;
    const first = c.open(1, "pdf");
    await expect(c.open(2, "pdf")).rejects.toThrow("in progress");
    await expect(first).rejects.toThrow("unknown");
    expect(t.commands.filter((b) => b[0] === 0xff)).toHaveLength(1);
    c.disconnect();
  });
  it("rejects pending work and invalidates states on connection loss", async () => {
    const c = new MachineController(100);
    const t = new FixtureTransport();
    await c.connect(t);
    t.noOpenReply = true;
    const first = c.open(1, "pdf");
    await new Promise((resolve) => setTimeout(resolve, 1));
    t.lost?.();
    await expect(first).rejects.toThrow("Connection lost");
    expect(c.getSnapshot().status).toBe("disconnected");
    expect(c.getSnapshot().doors).toEqual(Array(12).fill("unknown"));
  });
  it("rejects commands without a session", async () => {
    const c = new MachineController(25);
    await expect(c.open(1, "pdf")).rejects.toThrow("handshake");
    await expect(c.open(13, "pdf")).rejects.toThrow("1 to 12");
  });
  it("runs the same handshake and decoder against the simulator", async () => {
    const c = new MachineController(200);
    const t = new SimulatedTransport();
    await c.connect(t);
    await c.open(1, "pdf");
    expect(c.getSnapshot().doors[0]).toBe("open");
    t.closeDoor(1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(c.getSnapshot().doors[0]).toBe("closed");
    c.disconnect();
  });
});
it("a failed repeat handshake removes readiness instead of leaving unlock enabled", async () => {
  const c = new MachineController(25);
  const t = new FixtureTransport();
  await c.connect(t);
  t.rejectHandshake = true;
  await expect(c.handshake()).rejects.toThrow("rejected");
  expect(c.getSnapshot().status).toBe("disconnected");
  await expect(c.open(1, "pdf")).rejects.toThrow("handshake");
});
it("times out a hung native write even if a notification arrived", async () => {
  class HungWrite extends FixtureTransport {
    async write(bytes: Uint8Array) {
      await super.write(bytes);
      if (bytes[0] === 0xff) await new Promise<void>(() => {});
    }
  }
  const c = new MachineController(25);
  const t = new HungWrite();
  await c.connect(t);
  await expect(c.open(1, "pdf")).rejects.toThrow("result is unknown");
  expect(c.getSnapshot().busy).toBe(false);
  c.disconnect();
});
