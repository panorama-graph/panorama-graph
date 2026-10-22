import { describe, expect, test } from "bun:test";
import {
  NODE_TYPES,
  endpointKey,
  environmentKey,
  groupKey,
  httpApiKey,
  levelKey,
  libraryKey,
  nodeTypeFromKey,
  normalizeInterfaceVersion,
  normalizePath,
  pathVersion,
  personKey,
  resourceKey,
  splitServiceVersion,
  topicVersion,
  type NodeType,
} from "../src";

describe("receitas de chave", () => {
  test("endpoint sem os nomes dos parâmetros", () => {
    expect(endpointKey("product-api", "get", "/products/{id}")).toBe("endpoint:product-api/GET /products/{}");
    expect(endpointKey("product-api", "GET", "products//{productId}/")).toBe("endpoint:product-api/GET /products/{}");
    expect(normalizePath("/")).toBe("/");
  });

  test("biblioteca pelas coordenadas, sem versão", () => {
    expect(libraryKey("maven", "org.springframework.boot", "spring-boot")).toBe("lib:maven/org.springframework.boot:spring-boot");
    expect(libraryKey("npm", "@scope", "pkg")).toBe("lib:npm/@scope/pkg");
    expect(libraryKey("npm", undefined, "left-pad")).toBe("lib:npm/left-pad");
  });

  test("recurso pelo ambiente, e tipo do nó pelo prefixo do modelo", () => {
    expect(resourceKey("dev", "mongodb")).toBe("resource:dev/mongodb");
    expect(resourceKey("prd", "mongodb", "product-api")).toBe("resource:prd/mongodb/product-api");
    expect(environmentKey("prd")).toBe("env:prd");
    expect(nodeTypeFromKey(groupKey("team-a"))).toBe("Group");
    expect(levelKey("tribo")).toBe("level:tribo");
    expect(nodeTypeFromKey(levelKey("tribo"))).toBe("OrgLevel");
    expect(nodeTypeFromKey(personKey("ana.silva"))).toBe("Person");
    expect(nodeTypeFromKey("repo:host/a/b")).toBe("Repository");
    expect(nodeTypeFromKey("desconhecido:x")).toBeUndefined();
    expect(nodeTypeFromKey("sem-prefixo")).toBeUndefined();
    for (const type of Object.keys(NODE_TYPES) as NodeType[]) expect(nodeTypeFromKey(`${NODE_TYPES[type].prefix}:x`)).toBe(type);
  });

  test("API versionada: um nó por versão; o endpoint, na versão do código; sem versão, a chave de sempre", () => {
    expect(httpApiKey("product-api")).toBe("api:product-api/http");
    expect(httpApiKey("product-api", "v1")).toBe("api:product-api/v1/http");
    expect(httpApiKey("product-api", "2")).toBe("api:product-api/v2/http");
    expect(endpointKey("product-api", "get", "/v1/products/{id}", "v1")).toBe("endpoint:product-api/v1/GET /v1/products/{}");
  });

  test("convenção de versão: host, caminho e nome do tópico", () => {
    expect(normalizeInterfaceVersion("1")).toBe("v1");
    expect(normalizeInterfaceVersion("V02")).toBe("v2");
    expect(normalizeInterfaceVersion("1.2.0")).toBeUndefined();
    expect(splitServiceVersion("product-api-v1")).toEqual({ service: "product-api", version: "v1" });
    expect(splitServiceVersion("product-api")).toEqual({ service: "product-api" });
    expect(pathVersion("/v1/products")).toBe("v1");
    expect(pathVersion("/v2")).toBe("v2");
    expect(pathVersion("/products/v1")).toBeUndefined();
    expect(pathVersion("/vendors")).toBeUndefined();
    expect(topicVersion("product-created-v1")).toBe("v1");
    expect(topicVersion("credit.product-created.v3")).toBe("v3");
    expect(topicVersion("product-created")).toBeUndefined();
    expect(topicVersion("dev")).toBeUndefined();
  });
});
