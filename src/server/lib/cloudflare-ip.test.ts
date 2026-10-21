import { describe, expect, it } from "vitest";
import { isCloudflareIp } from "./cloudflare-ip";

describe("isCloudflareIp", () => {
  it("recognises Cloudflare IPv4 and IPv6 edge addresses", () => {
    expect(isCloudflareIp("172.67.141.199")).toBe(true);
    expect(isCloudflareIp("104.21.27.67")).toBe(true);
    expect(isCloudflareIp("162.158.1.1")).toBe(true);
    expect(isCloudflareIp("::ffff:172.68.0.1")).toBe(true);
    expect(isCloudflareIp("2606:4700:3031::ac43:8dc7")).toBe(true);
  });
  it("rejects other addresses", () => {
    expect(isCloudflareIp("45.7.228.105")).toBe(false);
    expect(isCloudflareIp("10.0.1.5")).toBe(false);
    expect(isCloudflareIp("2001:db8::1")).toBe(false);
    expect(isCloudflareIp("not-an-ip")).toBe(false);
  });
});
