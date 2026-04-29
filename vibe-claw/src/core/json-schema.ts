export type SchemaIssue = { path: string; message: string };

export function validateJsonSchema(schema: Record<string, unknown>, value: unknown): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  validateValue(schema, value, "body", issues);
  return issues;
}

function validateValue(schema: Record<string, unknown>, value: unknown, path: string, issues: SchemaIssue[]): void {
  const type = schema.type;
  if (type === "object") {
    if (!isObject(value)) {
      issues.push({ path, message: "必须是对象" });
      return;
    }
    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
    for (const key of required) {
      if (!(key in value)) issues.push({ path: `${path}.${key}`, message: "缺少必填字段" });
    }
    const properties = isObject(schema.properties) ? schema.properties : {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (key in value && isObject(childSchema)) validateValue(childSchema, value[key], `${path}.${key}`, issues);
    }
    return;
  }
  if (type === "string" && typeof value !== "string") issues.push({ path, message: "必须是字符串" });
  if (type === "number" && typeof value !== "number") issues.push({ path, message: "必须是数字" });
  if (type === "integer" && (!Number.isInteger(value))) issues.push({ path, message: "必须是整数" });
  if (type === "boolean" && typeof value !== "boolean") issues.push({ path, message: "必须是布尔值" });
  if (type === "array" && !Array.isArray(value)) issues.push({ path, message: "必须是数组" });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
