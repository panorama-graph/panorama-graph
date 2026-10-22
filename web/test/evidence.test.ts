import { describe, expect, test } from "bun:test";
import { evidenceHref, parseCodePointer, shortEvidence } from "../src/lib/evidence";

const T = "http://gitlab.local/{repo}/-/blob/{sha}/{path}";

describe("evidência", () => {
  test("URL vira o próprio link", () => {
    expect(evidenceHref("https://catalog.acmebank.example/components/x", T)).toBe("https://catalog.acmebank.example/components/x");
  });

  test("ponteiro de código usa o template, com a linha", () => {
    const sha = "c44e8aaa2d5050e2511628e4d5c66b049cf9ed27";
    expect(evidenceHref(`acme/credito/api@${sha}:build/architecture/openapi.json`, T)).toBe(
      `http://gitlab.local/acme/credito/api/-/blob/${sha}/build/architecture/openapi.json`,
    );
    expect(evidenceHref(`acme/credito/api@${sha}:src/Main.java#L31`, T)).toBe(`http://gitlab.local/acme/credito/api/-/blob/${sha}/src/Main.java#L31`);
    expect(evidenceHref("product-catalog-api@a1b2c3d:src/main/resources/application.yaml:12", T)).toBe(
      "http://gitlab.local/product-catalog-api/-/blob/a1b2c3d/src/main/resources/application.yaml#L12",
    );
  });

  test("ponteiro JSON fica no fragmento, sem linha", () => {
    const p = parseCodePointer("svc@abc123:build/openapi.json#/paths/~1products~1{id}/get");
    expect(p).toEqual({ repo: "svc", sha: "abc123", path: "build/openapi.json", fragment: "/paths/~1products~1{id}/get" });
  });

  test("sem template ou formato desconhecido: só texto", () => {
    expect(evidenceHref("svc@abc123:pom.xml", "")).toBeUndefined();
    expect(evidenceHref("k8s://acme-dev/dev/ingresses/x", T)).toBeUndefined();
  });

  test("texto curto encurta o sha", () => {
    expect(shortEvidence("svc@c44e8aaa2d5050e2511628e4d5c66b049cf9ed27:a/b.json#L3")).toBe("svc@c44e8aaa:a/b.json:3");
    expect(shortEvidence("k8s://x")).toBe("k8s://x");
  });
});
