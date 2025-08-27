"use client";

import { use, useCallback, useEffect, useId, useMemo, useState } from "react";
import TreeGraph from "@/components/TreeGraph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import type { Node, TreeOutput } from "@/lib/api";
import { getCallHistory, getTree, postDiscover, postRefine } from "@/lib/api";

type PageProps = {
  params: Promise<{ sessionId: string }>;
};

export default function SessionPage({ params }: PageProps) {
  const phoneId = useId();
  const { sessionId: routeSessionId } = use(params);
  const initialSessionId = decodeURIComponent(routeSessionId || "");

  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [tree, setTree] = useState<TreeOutput | null>(null);
  const [totalCost, setTotalCost] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState(initialSessionId);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [refining, setRefining] = useState(false);
  const [calls, setCalls] = useState<
    {
      callId: string;
      status?: string | null;
      answered_by?: string | null;
      price?: number | null;
      startedAt?: string | null;
      endedAt?: string | null;
    }[]
  >([]);

  const fetchTree = useCallback(async (sid: string) => {
    setLoading(true);
    setError(null);
    try {
      const t = await getTree(sid);
      setTree(t);
      setTotalCost(t?.totalCost ?? 0);
      const hist = await getCallHistory(sid);
      setCalls(hist.calls || []);
      setTotalCost(hist.totalCost ?? t?.totalCost ?? 0);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed fetching tree";
      setError(message);
      setTree(null);
      setCalls([]);
      setTotalCost(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionId) {
      fetchTree(sessionId);
    }
  }, [fetchTree, sessionId]);

  const onStart = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await postDiscover(phone);
      setSessionId(phone);
      await fetchTree(phone);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Discover failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [fetchTree, phone]);

  const onRefine = useCallback(async () => {
    if (!selectedNode || !sessionId) return;
    setRefining(true);
    try {
      await postRefine(selectedNode.id, sessionId);
      if (sessionId) await fetchTree(sessionId);
      setSelectedNode(null);
    } catch {
      // keep dialog open on error
    } finally {
      setRefining(false);
    }
  }, [fetchTree, selectedNode, sessionId]);

  const hasTree = useMemo(() => Boolean(tree?.root), [tree]);
  const visitedCount = tree?.visitedPaths?.length ?? 0;
  const pendingCount = tree?.pendingPaths?.length ?? 0;
  const totalPaths = visitedCount + pendingCount;
  const exploredPct =
    totalPaths > 0 ? Math.round((visitedCount / totalPaths) * 100) : 0;

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-semibold mb-6">IVR Discovery</h1>

      {!hasTree && (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Start Discovery</CardTitle>
            <CardDescription>
              Enter the phone number and start. Only one number is supported.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Label htmlFor={phoneId}>Phone Number</Label>
                <Input
                  id={phoneId}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1XXXXXXXXXX"
                />
              </div>
              <Button onClick={onStart} disabled={loading}>
                {loading ? "Starting…" : "Start"}
              </Button>
            </div>
            {error ? (
              <p className="text-sm text-red-600 mt-2">{error}</p>
            ) : null}
          </CardContent>
        </Card>
      )}

      {hasTree && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Session: {tree?.sessionId}
              {typeof totalCost === "number" ? (
                <> · Total cost: ${totalCost.toFixed(2)}</>
              ) : null}
            </div>
            <Button
              variant="secondary"
              onClick={() => sessionId && fetchTree(sessionId)}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Progress</CardTitle>
              <CardDescription>
                Overall exploration status for this IVR.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2 text-sm mb-3">
                <Badge variant="secondary">Visited {visitedCount}</Badge>
                <Badge variant="outline">Pending {pendingCount}</Badge>
                <Badge variant="secondary">
                  Calls {tree?.callsCount ?? calls.length}
                </Badge>
                <Badge variant="secondary">${totalCost.toFixed(2)}</Badge>
                {tree?.updatedAt ? (
                  <span className="text-muted-foreground">
                    Updated {new Date(tree.updatedAt).toLocaleString()}
                  </span>
                ) : null}
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Explored</span>
                  <span>
                    {visitedCount}/{totalPaths} ({exploredPct}%)
                  </span>
                </div>
                <Progress value={exploredPct} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Discovered IVR Tree</CardTitle>
              <CardDescription>
                Click a node to view details and refine.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full overflow-x-auto">
                {tree?.root ? (
                  <TreeGraph root={tree.root} onNodeClick={setSelectedNode} />
                ) : null}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Call Costs</CardTitle>
              <CardDescription>
                Per-call costs and overall total for this session.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {calls.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No calls yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left">
                        <th className="py-2 pr-4">Call ID</th>
                        <th className="py-2 pr-4">Status</th>
                        <th className="py-2 pr-4">Answered By</th>
                        <th className="py-2 pr-4">Start</th>
                        <th className="py-2 pr-4">End</th>
                        <th className="py-2 pr-0 text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calls.map((c) => (
                        <tr key={c.callId} className="border-t">
                          <td className="py-2 pr-4 whitespace-nowrap max-w-[240px] truncate">
                            {c.callId}
                          </td>
                          <td className="py-2 pr-4">{c.status || "-"}</td>
                          <td className="py-2 pr-4">{c.answered_by || "-"}</td>
                          <td className="py-2 pr-4">
                            {c.startedAt
                              ? new Date(c.startedAt).toLocaleString()
                              : "-"}
                          </td>
                          <td className="py-2 pr-4">
                            {c.endedAt
                              ? new Date(c.endedAt).toLocaleString()
                              : "-"}
                          </td>
                          <td className="py-2 pr-0 text-right">
                            $
                            {typeof c.price === "number"
                              ? c.price.toFixed(2)
                              : "0.00"}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t font-medium">
                        <td className="py-2 pr-4" colSpan={5}>
                          Total
                        </td>
                        <td className="py-2 pr-0 text-right">
                          ${totalCost.toFixed(2)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog
        open={!!selectedNode}
        onOpenChange={(o) => !o && setSelectedNode(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Node Details</DialogTitle>
            <DialogDescription>
              Information for the selected node.
            </DialogDescription>
          </DialogHeader>
          {selectedNode ? (
            <div className="space-y-3">
              <div>
                <div className="text-sm text-muted-foreground">ID</div>
                <div className="text-sm">{selectedNode.id}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Prompt</div>
                <div className="text-sm whitespace-pre-wrap">
                  {selectedNode.promptText}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Confidence</div>
                <div className="text-sm">
                  {(selectedNode.confidence * 100).toFixed(0)}%
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Options</div>
                <ul className="list-disc pl-5 text-sm">
                  {selectedNode.options.map((o, idx) => (
                    <li
                      key={`${selectedNode.id}-${o.digit}-${o.targetNodeId ?? "pending"}-${idx}`}
                    >
                      {o.digit}: {o.label}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="pt-2">
                <Button onClick={onRefine} disabled={refining}>
                  {refining ? "Refining…" : "Refine"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}
