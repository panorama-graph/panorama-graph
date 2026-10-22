import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TECHS, techInfo, techOf } from "../src/lib/tech";
import { stackOf } from "../src/lib/graphLayout";

describe("techOf", () => {
  test("framework vence a linguagem, qualquer que seja a ordem da stack", () => {
    expect(techOf(["tech:gradle", "tech:java", "tech:spring-boot"])).toBe("spring");
    expect(techOf(["tech:java"])).toBe("java");
  });
  test("recurso pela instância ou pelo nome, por pedaço do nome", () => {
    expect(techOf(["mongodb", "product-catalog"])).toBe("mongodb");
    expect(techOf(["kafka"])).toBe("kafka");
    expect(techOf(["postgres-16"])).toBe("postgresql");
  });
  test("nada reconhecido: sem ícone, e pedaço não é substring", () => {
    expect(techOf(["tech:service-platform", "cargo", undefined])).toBeUndefined();
  });
});

describe("bancos conhecidos", () => {
  test("cada um tem ícone ou logo em images/", () => {
    const images = join(import.meta.dir, "..", "images");
    const missing = TECHS.filter((t) => t.role === "store").filter((t) => !["icon", "logo"].some((v) => existsSync(join(images, `${t.id}-${v}.svg`))));
    expect(missing.map((t) => t.id)).toEqual([]);
  });
  test("pelo nome da instância ou do motor", () => {
    expect(techOf(["tech:sqlserver"])).toBe("sqlserver");
    expect(techOf(["mssql-2022"])).toBe("sqlserver");
    expect(techOf(["opensearch", "logs"])).toBe("opensearch");
    expect(techOf(["aws-s3"])).toBe("s3");
  });
});

describe("techInfo", () => {
  test("papel de cada tecnologia da stack", () => {
    expect(techInfo("tech:java")?.role).toBe("language");
    expect(techInfo("tech:spring-boot")?.role).toBe("framework");
    expect(techInfo("tech:gradle")?.role).toBe("build");
    expect(techInfo("tech:service-platform")).toBeUndefined();
  });
});

describe("stackOf", () => {
  test("conhecidas por papel, depois as demais; versão das afirmações", () => {
    const fact = (version: string) => ({ source: "build-manifest", state: "observed", status: "current", props: { version } }) as never;
    const stack = stackOf([
      { key: "tech:service-platform", facts: [fact("1.2.0")] },
      { key: "tech:gradle", facts: [fact("9.5.1")] },
      { key: "tech:spring-boot", facts: [fact("4.1.0")] },
      { key: "tech:java", facts: [fact("25"), fact("25")] },
    ]);
    expect(stack.map((t) => [t.name, t.role, t.version])).toEqual([
      ["java", "language", "25"],
      ["spring-boot", "framework", "4.1.0"],
      ["gradle", "build", "9.5.1"],
      ["service-platform", undefined, "1.2.0"],
    ]);
  });
});

describe("stackOf com bibliotecas", () => {
  test("tecnologia com o nome de um componente library ganha o ícone de biblioteca", () => {
    const stack = stackOf([{ key: "tech:service-platform", facts: [] }, { key: "tech:java", facts: [] }], new Set(["service-platform"]));
    expect(stack.map((t) => [t.name, t.tech])).toEqual([
      ["java", "java"],
      ["service-platform", "library"],
    ]);
  });
});
