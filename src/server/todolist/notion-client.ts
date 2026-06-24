export interface NotionPage {
  id: string;
  url: string;
  properties: Record<string, Record<string, unknown>>;
  last_edited_time?: string;
}

export interface NotionQueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface NotionClientOptions {
  token: string;
  databaseId: string;
}

export async function queryNotionDatabase(
  opts: NotionClientOptions
): Promise<NotionPage[]> {
  const { token, databaseId } = opts;
  const pages: NotionPage[] = [];
  let startCursor: string | undefined;

  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (startCursor) body["start_cursor"] = startCursor;

    const resp = await fetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => `HTTP ${resp.status}`);
      throw new Error(`Notion API error ${resp.status}: ${text}`);
    }

    const data = (await resp.json()) as NotionQueryResponse;
    pages.push(...data.results);

    startCursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (startCursor);

  return pages;
}
