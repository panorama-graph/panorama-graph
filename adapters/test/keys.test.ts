import { describe, expect, test } from "bun:test";
import { endpointKey, groupKey, libraryKey, matchesTemplate, nodeTypeFromKey, normalizePath, parsePurl, personKey, resourceKey } from "../src/core/keys";
import { parseRepositoryUrl } from "../src/graph-publish/identity";

describe("receitas de chave", () => {
  test("endpoint sem os nomes dos parâmetros", () => {
    expect(endpointKey("product-catalog", "get", "/products/{id}")).toBe("endpoint:product-catalog/GET /products/{}");
    expect(endpointKey("product-catalog", "GET", "products//{productId}/")).toBe("endpoint:product-catalog/GET /products/{}");
    expect(normalizePath("/")).toBe("/");
  });

  test("caminho concreto do pact casa com o modelo do cliente", () => {
    expect(matchesTemplate("/products/product-1", "/products/{id}")).toBe(true);
    expect(matchesTemplate("/products/product-1?x=1", "/products/{id}")).toBe(true);
    expect(matchesTemplate("/products", "/products/{id}")).toBe(false);
    expect(matchesTemplate("/orders/1", "/products/{id}")).toBe(false);
  });

  test("biblioteca pelo purl, sem versão", () => {
    const p = parsePurl("pkg:maven/org.springframework.boot/spring-boot@4.1.0?type=jar")!;
    expect(p).toEqual({ type: "maven", namespace: "org.springframework.boot", name: "spring-boot", version: "4.1.0" });
    expect(libraryKey(p.type, p.namespace, p.name)).toBe("lib:maven/org.springframework.boot:spring-boot");
    const npm = parsePurl("pkg:npm/%40scope/pkg@1.0.0")!;
    expect(libraryKey(npm.type, npm.namespace, npm.name)).toBe("lib:npm/@scope/pkg");
    expect(libraryKey("npm", undefined, "left-pad")).toBe("lib:npm/left-pad");
  });

  test("host e caminho das formas comuns de URL de repositório", () => {
    const expected = { host: "gitlab.acmebank.example", path: "acme/credito/product-catalog-api" };
    expect(parseRepositoryUrl("ssh://git@gitlab.acmebank.example:2224/acme/credito/product-catalog-api.git")).toEqual(expected);
    expect(parseRepositoryUrl("git@gitlab.acmebank.example:acme/credito/product-catalog-api.git")).toEqual(expected);
    expect(parseRepositoryUrl("https://gitlab.acmebank.example/acme/credito/product-catalog-api")).toEqual(expected);
    expect(parseRepositoryUrl("não é url")).toBeUndefined();
  });

  test("recurso pelo ambiente, e tipo do nó pelo prefixo", () => {
    expect(resourceKey("dev", "mongodb")).toBe("resource:dev/mongodb");
    expect(resourceKey("prd", "mongodb", "product-catalog")).toBe("resource:prd/mongodb/product-catalog");
    expect(nodeTypeFromKey(groupKey("squad-a"))).toBe("Group");
    expect(nodeTypeFromKey(personKey("ana.silva"))).toBe("Person");
    expect(nodeTypeFromKey("repo:host/a/b")).toBe("Repository");
    expect(nodeTypeFromKey("desconhecido:x")).toBeUndefined();
    expect(nodeTypeFromKey("sem-prefixo")).toBeUndefined();
  });
});
