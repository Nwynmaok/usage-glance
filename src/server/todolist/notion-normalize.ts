import type { TodolistTask } from "./types.js";
import type { TodolistConfig } from "./types.js";

type NotionPropertyValue = Record<string, unknown>;
type NotionProperties = Record<string, NotionPropertyValue>;

function extractTitle(prop: NotionPropertyValue): string {
  const arr = prop["title"] as Array<{ plain_text?: string }> | undefined;
  return arr?.[0]?.plain_text ?? "";
}

function extractRichText(prop: NotionPropertyValue): string | null {
  const arr = prop["rich_text"] as Array<{ plain_text?: string }> | undefined;
  return arr?.[0]?.plain_text ?? null;
}

function extractSelect(prop: NotionPropertyValue): string | null {
  const sel = prop["select"] as { name?: string } | null | undefined;
  return sel?.name ?? null;
}

function extractMultiSelect(prop: NotionPropertyValue): string | null {
  const arr = prop["multi_select"] as Array<{ name?: string }> | undefined;
  return arr?.[0]?.name ?? null;
}

function extractStatus(prop: NotionPropertyValue): string | null {
  const s = prop["status"] as { name?: string } | null | undefined;
  return s?.name ?? null;
}

function extractDate(prop: NotionPropertyValue): string | null {
  const d = prop["date"] as { start?: string | null } | null | undefined;
  return d?.start ?? null;
}

function extractCheckbox(prop: NotionPropertyValue): boolean {
  return prop["checkbox"] === true;
}

function extractLastEditedTime(prop: NotionPropertyValue): string | null {
  const val = prop["last_edited_time"];
  return typeof val === "string" ? val : null;
}

function extractUrl(prop: NotionPropertyValue): string | null {
  const val = prop["url"];
  return typeof val === "string" ? val : null;
}

function extractStringProp(
  properties: NotionProperties,
  propName: string | undefined
): string | null {
  if (!propName) return null;
  const prop = properties[propName];
  if (!prop) return null;
  const type = prop["type"] as string | undefined;
  switch (type) {
    case "rich_text":
      return extractRichText(prop);
    case "select":
      return extractSelect(prop);
    case "multi_select":
      return extractMultiSelect(prop);
    case "status":
      return extractStatus(prop);
    case "date":
      return extractDate(prop);
    case "last_edited_time":
      return extractLastEditedTime(prop);
    case "url":
      return extractUrl(prop);
    default:
      return null;
  }
}

function extractBoolProp(
  properties: NotionProperties,
  propName: string | undefined
): boolean {
  if (!propName) return false;
  const prop = properties[propName];
  if (!prop) return false;
  if (prop["type"] === "checkbox") return extractCheckbox(prop);
  return false;
}

export function normalizeNotionPage(
  page: {
    id: string;
    url?: string;
    properties: NotionProperties;
    last_edited_time?: string;
  },
  propertyMap: TodolistConfig["notion"]["propertyMap"]
): TodolistTask {
  const properties = page.properties;

  const titleProp = properties[propertyMap.title];
  const title = titleProp ? extractTitle(titleProp) : "";

  let lastEditedAt: string | null = page.last_edited_time ?? null;
  if (!lastEditedAt && propertyMap.lastEdited) {
    lastEditedAt = extractStringProp(properties, propertyMap.lastEdited);
  }

  return {
    notionPageId: page.id,
    title,
    status: extractStringProp(properties, propertyMap.status),
    priority: extractStringProp(properties, propertyMap.priority),
    dueDate: extractStringProp(properties, propertyMap.dueDate),
    project: extractStringProp(properties, propertyMap.project),
    effort: extractStringProp(properties, propertyMap.effort),
    blocked: extractBoolProp(properties, propertyMap.blocked),
    waiting: extractBoolProp(properties, propertyMap.waiting),
    lastEditedAt,
    nextAction: extractStringProp(properties, propertyMap.nextAction),
    url: page.url ?? null,
  };
}
