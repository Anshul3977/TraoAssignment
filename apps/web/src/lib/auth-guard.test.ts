import { describe, expect, it } from "vitest";
import { decideAuthRedirect, isApiProxyPath, isPublicPath } from "./auth-guard";

describe("isPublicPath", () => {
  it("allows login and register only", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/register")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/kits/new")).toBe(false);
  });
});

describe("decideAuthRedirect", () => {
  it("sends signed-out visitors from protected routes to /login?next=", () => {
    expect(decideAuthRedirect("/", false)).toEqual({
      action: "redirect",
      to: "/login?next=%2F",
    });
    expect(decideAuthRedirect("/kits/new", false)).toEqual({
      action: "redirect",
      to: "/login?next=%2Fkits%2Fnew",
    });
  });

  it("allows signed-out visitors on login/register", () => {
    expect(decideAuthRedirect("/login", false)).toEqual({ action: "allow" });
    expect(decideAuthRedirect("/register", false)).toEqual({ action: "allow" });
  });

  it("sends signed-in visitors away from login/register to dashboard", () => {
    expect(decideAuthRedirect("/login", true)).toEqual({
      action: "redirect",
      to: "/",
    });
    expect(decideAuthRedirect("/register", true)).toEqual({
      action: "redirect",
      to: "/",
    });
  });

  it("allows signed-in visitors on protected routes", () => {
    expect(decideAuthRedirect("/", true)).toEqual({ action: "allow" });
  });
});

describe("isApiProxyPath", () => {
  it("matches the Next → Express rewrite prefix", () => {
    expect(isApiProxyPath("/api")).toBe(true);
    expect(isApiProxyPath("/api/auth/register")).toBe(true);
    expect(isApiProxyPath("/api/kits")).toBe(true);
    expect(isApiProxyPath("/register")).toBe(false);
    expect(isApiProxyPath("/apiculture")).toBe(false);
  });
});
