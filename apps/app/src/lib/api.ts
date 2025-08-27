export type Option = {
  digit: string;
  label: string;
  targetNodeId: string | null;
};

export type Node = {
  id: string;
  parentId: string | null;
  promptText: string;
  confidence: number;
  options: Option[];
  children: Node[];
};

export type TreeOutput = {
  sessionId: string;
  root: Node;
  totalCost?: number;
  callsCount?: number;
  visitedPaths?: string[][];
  pendingPaths?: string[][];
  updatedAt?: string;
};

const API_BASE = "http://localhost:4000";

export async function postDiscover(phone: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}/discover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discover failed: ${res.status} ${text}`);
  }
  return await res.json().catch(() => ({}));
}

export async function getTree(sessionId: string): Promise<TreeOutput | null> {
  const res = await fetch(`${API_BASE}/tree/${encodeURIComponent(sessionId)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Fetch tree failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TreeOutput;
}

export async function postRefine(
  nodeId: string,
  sessionId: string,
): Promise<Node> {
  const res = await fetch(`${API_BASE}/refine/${encodeURIComponent(nodeId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Refine failed: ${res.status} ${text}`);
  }
  return (await res.json()) as Node;
}

export type CallRecord = {
  callId: string;
  status?: string | null;
  answered_by?: string | null;
  price?: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
};

export type CallHistory = {
  sessionId: string;
  calls: CallRecord[];
  totalCost?: number;
};

export async function getCallHistory(sessionId: string): Promise<CallHistory> {
  const res = await fetch(
    `${API_BASE}/call-history/${encodeURIComponent(sessionId)}`,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Fetch call history failed: ${res.status} ${text}`);
  }
  return (await res.json()) as CallHistory;
}
