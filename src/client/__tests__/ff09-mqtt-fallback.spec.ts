import { afterEach, describe, expect, it, vi } from "vitest";
import { StationUnreachableError, type Command } from "../../core/contracts.js";
import type { EufyDevice } from "../../core/types.js";
import { DeviceType } from "../../model/device-types.js";
import { EufyMega } from "../eufy-mega.js";

const LOCK = "T8520K0000000000";

const actuate = { kind: "ff09-actuate", engage: true } as unknown as Command;
const keyed = { kind: "keyed-payload-actuate", engage: true } as unknown as Command;

/** A Wi-Fi lock that carries a `p2p_did` (so P2P claims it) and a product model (so MQTT can address it). */
function fixture(overrides: Partial<EufyDevice> = {}) {
  const client = new EufyMega({
    email: "test@example.com",
    password: "synthetic",
    autoRealtime: false,
    pollMs: 0,
    storedSnapshotCache: false,
  });
  const internals = client as unknown as {
    registry: { devices: EufyDevice[] };
    p2p: { dispatchCommand(sn: string, cmd: Command): Promise<void> };
    mqtt: { dispatchCommand(sn: string, cmd: Command): Promise<void> };
    routeCommand(sn: string, cmd: Command): Promise<void>;
  };
  internals.registry.devices = [
    {
      sn: LOCK,
      model: "T8520",
      api: "mega",
      p2pDid: "SYNTH-000000-AAAAA",
      raw: { device_type: DeviceType.LOCK_WIFI },
      ...overrides,
    } as EufyDevice,
  ];
  const p2p = vi.spyOn(internals.p2p, "dispatchCommand");
  const mqtt = vi.spyOn(internals.mqtt, "dispatchCommand").mockResolvedValue();
  return { internals, p2p, mqtt };
}

const unreachable = () => new StationUnreachableError(LOCK, 45_000);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ff09 fallback to secure MQTT when P2P is unreachable", () => {
  it("keeps P2P when it delivers", async () => {
    const { internals, p2p, mqtt } = fixture();
    p2p.mockResolvedValue();
    await internals.routeCommand(LOCK, actuate);
    expect(p2p).toHaveBeenCalledExactlyOnceWith(LOCK, actuate);
    expect(mqtt).not.toHaveBeenCalled();
  });

  it("retries over MQTT when the P2P session never connects", async () => {
    const { internals, p2p, mqtt } = fixture();
    p2p.mockRejectedValue(unreachable());
    await internals.routeCommand(LOCK, actuate);
    expect(p2p).toHaveBeenCalledOnce();
    expect(mqtt).toHaveBeenCalledExactlyOnceWith(LOCK, actuate);
  });

  it("goes straight to MQTT while the device is remembered as unreachable, then tries P2P again", async () => {
    vi.useFakeTimers();
    const { internals, p2p, mqtt } = fixture();
    p2p.mockRejectedValueOnce(unreachable()).mockResolvedValue();
    await internals.routeCommand(LOCK, actuate);
    await internals.routeCommand(LOCK, actuate);
    expect(p2p).toHaveBeenCalledOnce();
    expect(mqtt).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await internals.routeCommand(LOCK, actuate);
    expect(p2p).toHaveBeenCalledTimes(2);
    expect(mqtt).toHaveBeenCalledTimes(2);
  });

  it("does not fall back when the session connected and the device refused", async () => {
    const { internals, p2p, mqtt } = fixture();
    p2p.mockRejectedValue(new Error("device answered -151"));
    await expect(internals.routeCommand(LOCK, actuate)).rejects.toThrow("-151");
    expect(mqtt).not.toHaveBeenCalled();
  });

  it("does not fall back for the keyed-payload envelope, which only P2P carries", async () => {
    const { internals, p2p, mqtt } = fixture();
    p2p.mockRejectedValue(unreachable());
    await expect(internals.routeCommand(LOCK, keyed)).rejects.toBeInstanceOf(StationUnreachableError);
    expect(mqtt).not.toHaveBeenCalled();
  });

  it("does not fall back for a device MQTT cannot address (no product model)", async () => {
    const { internals, p2p, mqtt } = fixture({ model: "" });
    p2p.mockRejectedValue(unreachable());
    await expect(internals.routeCommand(LOCK, actuate)).rejects.toBeInstanceOf(StationUnreachableError);
    expect(mqtt).not.toHaveBeenCalled();
  });
});
