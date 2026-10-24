import { describe, expect, test } from "vitest";
import { edgeLabel, fromDependencyEdges, fromOverview, layout, toGraphNode } from "../src/lib/graphLayout";
import type { DependencyEdge } from "../src/lib/types";

const facts = { dependent: [{ source: "pact", evidence: "e" }], provider: [{ source: "openapi", evidence: "e" }] };
const A = "component:a";
const B = "component:b";
const C = "component:c";

describe("grafo de dependências", () => {
  test("rótulo resume as vias e conta os endpoints", () => {
    expect(
      edgeLabel([
        { type: "CONSUMES", node: "api:b/http", facts },
        { type: "CALLS", node: "endpoint:b/GET /x", facts },
        { type: "CALLS", node: "endpoint:b/GET /y", facts },
      ]),
    ).toBe("API · 2 endpoints");
    expect(edgeLabel([{ type: "SUBSCRIBES", node: "topic:t", facts }])).toBe("evento");
  });

  test("arestas do component_dependencies viram uma por par, sem repetir a via", () => {
    const e = (from: string, to: string, type: string, node: string): DependencyEdge => ({ from, to, via: { type, node: { key: node, type: "Api" } }, facts });
    const edges = fromDependencyEdges([e(A, B, "CONSUMES", "api:b"), e(A, B, "CONSUMES", "api:b"), e(A, B, "CALLS", "endpoint:b/GET /x"), e(B, C, "SUBSCRIBES", "topic:t")]);
    expect(edges.map((x) => [x.id, x.via.length, x.label])).toEqual([
      [`${A}->${B}`, 2, "API · 1 endpoint"],
      [`${B}->${C}`, 1, "evento"],
    ]);
  });

  test("layout: quem depende fica à esquerda; arestas para fora da lista caem", () => {
    const nodes = [A, B, C].map((key) => toGraphNode({ key, type: "Component" }, A));
    const edges = fromOverview([
      { from: A, to: B, via: [{ type: "CONSUMES", node: "api:b", facts }] },
      { from: B, to: "component:fora", via: [{ type: "CONSUMES", node: "api:fora", facts }] },
    ]);
    const out = layout(nodes, edges);
    const x = Object.fromEntries(out.nodes.map((n) => [n.key, n.x]));
    expect(x[A]).toBeLessThan(x[B]);
    expect(out.edges.map((e) => e.id)).toEqual([`${A}->${B}`]);
    expect(out.nodes.find((n) => n.key === A)!.center).toBe(true);
    expect(out.nodes.find((n) => n.key === A)!.name).toBe("a");
  });
});

describe("nome de exibição", () => {
  test("endpoint e API pela chave", async () => {
    const { displayName } = await import("../src/lib/nodes");
    expect(displayName({ key: "endpoint:product-catalog-api/GET /products/{}" })).toBe("GET /products/{}");
    expect(displayName({ key: "api:product-catalog-api/http" })).toBe("product-catalog-api/http");
    expect(displayName({ key: "component:x" })).toBe("x");
    expect(displayName({ key: "lib:maven/org.acme:service-platform", name: "service-platform" })).toBe("service-platform");
  });
});

describe("componente no recorte de um ambiente", () => {
  test("a versão implantada vem na legenda; sem ela, a legenda é o kind", () => {
    expect(toGraphNode({ key: A, type: "Component", kind: "service", version: "1.0.0" }).caption).toBe("service · 1.0.0");
    expect(toGraphNode({ key: A, type: "Component", kind: "service" })).not.toHaveProperty("caption");
  });
});
