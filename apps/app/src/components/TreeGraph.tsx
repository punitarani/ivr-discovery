"use client";

import * as d3 from "d3";
import { useEffect, useMemo, useRef } from "react";
import type { Node } from "@/lib/api";

export type TreeGraphProps = {
  root: Node;
  width?: number;
  height?: number;
  onNodeClick?: (node: Node) => void;
};

export function TreeGraph({
  root,
  width = 900,
  height = 640,
  onNodeClick,
}: TreeGraphProps) {
  const ref = useRef<SVGSVGElement | null>(null);
  const controlsRef = useRef<{
    zoomIn: () => void;
    zoomOut: () => void;
    reset: () => void;
    fit: () => void;
  } | null>(null);

  const data = useMemo(() => root, [root]);

  useEffect(() => {
    if (!ref.current) return;

    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();

    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const hierarchy = d3.hierarchy<Node>(data, (d) => d.children);
    // Top-down layout: x = horizontal spacing, y = depth spacing
    const nodeHeight = 110;
    const nodeWidth = 220;
    const treeLayout = d3.tree<Node>().nodeSize([nodeWidth, nodeHeight]);
    const rootNode = treeLayout(hierarchy);

    // Zoomable canvas group
    const canvas = svg.append("g").attr("data-canvas", "true");

    type LinkPoint = {
      source: { x: number; y: number };
      target: { x: number; y: number };
      pending?: boolean;
    };

    // Build link set including pending edges
    const links: LinkPoint[] = [];
    rootNode.each((d) => {
      d.children?.forEach((c) => {
        links.push({ source: { x: d.x, y: d.y }, target: { x: c.x, y: c.y } });
      });
      const pendingCount = (d.data.options || []).filter(
        (o) => !o.targetNodeId,
      ).length;
      for (let i = 0; i < pendingCount; i++) {
        links.push({
          source: { x: d.x, y: d.y },
          target: { x: d.x, y: d.y + nodeHeight },
          pending: true,
        });
      }
    });

    canvas
      .append("g")
      .attr("fill", "none")
      .attr("stroke", "#e5e7eb")
      .attr("stroke-width", 1.5)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("x1", (d: LinkPoint) => d.source.x + 20)
      .attr("y1", (d: LinkPoint) => d.source.y + 40)
      .attr("x2", (d: LinkPoint) => d.target.x + 20)
      .attr("y2", (d: LinkPoint) => d.target.y + 40)
      .attr("stroke-dasharray", (d: LinkPoint) => (d.pending ? "4 3" : null));

    type PointNode = { x: number; y: number; data: Node };

    const node = canvas
      .append("g")
      .attr("stroke-linejoin", "round")
      .attr("stroke-width", 1)
      .selectAll("g")
      .data(rootNode.descendants() as unknown as PointNode[])
      .join("g")
      .attr(
        "transform",
        (d: PointNode) => `translate(${d.x + 20},${d.y + 40})`,
      );

    const colorFor = (conf: number) => {
      if (conf >= 0.9) return "#16a34a";
      if (conf < 0.5) return "#dc2626";
      return "#f59e0b";
    };

    const isTerminal = (n: Node) => {
      if (!n.options || n.options.length === 0) return true;
      return n.options.every((o) => !o.targetNodeId);
    };

    node
      .append("circle")
      .attr("r", 14)
      .attr("fill", (d: PointNode) => colorFor(d.data.confidence))
      .attr("stroke", "#111827")
      .attr("stroke-width", (d: PointNode) => (isTerminal(d.data) ? 2.5 : 1))
      .style("cursor", "pointer")
      .on("click", (_evt: unknown, d: PointNode) => onNodeClick?.(d.data));

    node
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", 10)
      .attr("fill", "#ffffff")
      .style("pointer-events", "none")
      .text((d: PointNode) => {
        const id = d.data.id || "";
        const parts = id.split("-");
        return parts[parts.length - 1] || id;
      });

    node
      .append("text")
      .attr("dy", "1.6em")
      .attr("text-anchor", "middle")
      .attr("font-size", 11)
      .attr("fill", "#374151")
      .style("cursor", "pointer")
      .text((d: PointNode) => {
        const t = d.data.promptText || "";
        const short = t.length > 20 ? `${t.slice(0, 17)}...` : t;
        return short;
      })
      .on("click", (_evt: unknown, d: PointNode) => onNodeClick?.(d.data));

    // Pending phantom nodes
    const pendingNodes: { x: number; y: number }[] = [];
    rootNode.each((d) => {
      const pending = (d.data.options || []).filter(
        (o) => !o.targetNodeId,
      ).length;
      for (let i = 0; i < pending; i++) {
        pendingNodes.push({ x: d.x, y: d.y + nodeHeight });
      }
    });
    canvas
      .append("g")
      .selectAll("circle")
      .data(pendingNodes)
      .join("circle")
      .attr("cx", (p) => p.x + 20)
      .attr("cy", (p) => p.y + 40)
      .attr("r", 10)
      .attr("fill", "#9ca3af")
      .attr("stroke", "#6b7280");

    // d3 zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 3])
      .on("zoom", (event) => {
        canvas.attr("transform", String(event.transform));
      });

    svg.call(
      zoom as unknown as (
        selection: d3.Selection<SVGSVGElement, unknown, null, undefined>,
      ) => void,
    );

    // helpers
    const fitToView = () => {
      const bbox = (canvas.node() as SVGGElement).getBBox();
      const pad = 40;
      const scale = Math.min(
        width / (bbox.width + pad * 2),
        height / (bbox.height + pad * 2),
      );
      const tx = width / 2 - scale * (bbox.x + bbox.width / 2);
      const ty = height / 2 - scale * (bbox.y + bbox.height / 2);
      svg
        .transition()
        .duration(300)
        .call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    };

    const reset = () => {
      svg.transition().duration(200).call(zoom.transform, d3.zoomIdentity);
    };
    const zoomIn = () => svg.transition().duration(150).call(zoom.scaleBy, 1.2);
    const zoomOut = () =>
      svg
        .transition()
        .duration(150)
        .call(zoom.scaleBy, 1 / 1.2);

    controlsRef.current = { zoomIn, zoomOut, reset, fit: fitToView };

    // auto fit initially
    fitToView();

    return () => {
      svg.selectAll("*").remove();
    };
  }, [data, height, onNodeClick, width]);

  return (
    <div className="relative w-full" style={{ height }}>
      <svg ref={ref} width="100%" height={height} />
      <div className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-white/80 p-1 shadow-sm backdrop-blur-sm">
        <button
          type="button"
          aria-label="Zoom in"
          className="h-7 w-7 rounded border text-sm leading-none hover:bg-gray-100"
          onClick={() => controlsRef.current?.zoomIn()}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          className="h-7 w-7 rounded border text-sm leading-none hover:bg-gray-100"
          onClick={() => controlsRef.current?.zoomOut()}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Fit"
          className="h-7 rounded border px-2 text-xs leading-none hover:bg-gray-100"
          onClick={() => controlsRef.current?.fit()}
        >
          Fit
        </button>
        <button
          type="button"
          aria-label="Reset"
          className="h-7 rounded border px-2 text-xs leading-none hover:bg-gray-100"
          onClick={() => controlsRef.current?.reset()}
        >
          100%
        </button>
      </div>
    </div>
  );
}

export default TreeGraph;
