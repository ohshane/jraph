import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { Menu, Maximize2, Minimize2, RotateCcw, Settings } from "lucide-react";

// --------------------------- Types ---------------------------

type NodeType = "object" | "array" | "value";

type TreeNode = {
  name: string;
  path: string;
  type: NodeType;
  value?: any;
  children?: TreeNode[];
};

type GraphNode = {
  id: string; // same as path
  label: string;
  type: NodeType;
  color?: string;
};

type GraphLink = {
  source: string; // path
  target: string; // path
};

type GraphParams = {
  linkDistance: number;
  linkStrength: number;
  chargeStrength: number; // negative for repulsion
  collisionPadding: number;
  nodeRadiusValue: number;
  nodeRadiusArray: number;
  nodeRadiusObject: number;
  zoomMin: number;
  zoomMax: number;
};

// --------------------------- Utils ---------------------------

function shortLabel(v: any, max = 28): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function isPlainObject(v: any) {
  return Object.prototype.toString.call(v) === "[object Object]";
}

function makePath(parent: string, key: string): string {
  if (!parent) return key;
  // array index already formatted as [i]
  if (key.startsWith("[")) return parent + key;
  return `${parent}.${key}`;
}

// Build a Tree from JSON
function jsonToTree(value: any, path = "root", name = "root"): TreeNode {
  if (Array.isArray(value)) {
    const children: TreeNode[] = value.map((v, i) =>
      jsonToTree(v, makePath(path, `[${i}]`), `[${i}]`)
    );
    return { name, path, type: "array", children };
  }
  if (isPlainObject(value)) {
    const children: TreeNode[] = Object.entries(value).map(([k, v]) =>
      jsonToTree(v, makePath(path, k), k)
    );
    return { name, path, type: "object", children };
  }
  // primitive
  return { name, path, type: "value", value };
}

// Convert Tree to Graph (nodes/links)
function treeToGraph(root: TreeNode) {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];

  function walk(t: TreeNode) {
    nodes.push({ id: t.path, label: t.name + (t.type === "value" ? `: ${shortLabel(t.value)}` : ""), type: t.type });
    if (t.children && t.children.length) {
      for (const c of t.children) {
        links.push({ source: t.path, target: c.path });
        walk(c);
      }
    }
  }
  walk(root);
  return { nodes, links };
}


function buildMaps(root: TreeNode) {
  const parentMap = new Map<string, string | null>();
  const nodeMap = new Map<string, TreeNode>();
  (function walk(n: TreeNode, parent: string | null) {
    parentMap.set(n.path, parent);
    nodeMap.set(n.path, n);
    if (n.children) {
      for (const c of n.children) walk(c, n.path);
    }
  })(root, null);
  return { parentMap, nodeMap };
}


// --------------------------- Components ---------------------------

function UploadJson({ onLoad }: { onLoad: (data: any) => void }) {
  const [error, setError] = useState<string | null>(null);

  const onChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      onLoad(data);
    } catch (err: any) {
      setError(err?.message ?? "Failed to parse JSON");
    }
  };

  // Drag & drop (optional convenience)
  const dropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    const prevent = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onDrop = async (e: DragEvent) => {
      prevent(e);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        onLoad(data);
      } catch (err: any) {
        setError(err?.message ?? "Failed to parse JSON");
      }
    };
    ["dragenter", "dragover", "dragleave", "drop"].forEach((ev) => el.addEventListener(ev, prevent));
    el.addEventListener("drop", onDrop);
    return () => {
      ["dragenter", "dragover", "dragleave", "drop"].forEach((ev) => el.removeEventListener(ev, prevent));
      el.removeEventListener("drop", onDrop);
    };
  }, [onLoad]);

  return (
    <div className="flex items-center gap-3">
      <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-300 cursor-pointer hover:bg-neutral-50">
        <input type="file" accept="application/json" onChange={onChange} className="hidden" />
        <span className="text-sm font-medium">Upload JSON</span>
      </label>
      <div ref={dropRef} className="text-xs text-neutral-500">or drag & drop a file here</div>
      {error && <div className="text-xs text-red-500">{error}</div>}
    </div>
  );
}

function TreeView({ root, onSelect, selected, open, onOpenChange }: { root: TreeNode; onSelect: (path: string) => void; selected?: string | null; open: Set<string>; onOpenChange: (next: Set<string>) => void }) {
  const toggle = (p: string) => {
    const next = new Set(open);
    if (next.has(p)) next.delete(p); else next.add(p);
    onOpenChange(next);
  };

  const [menu, setMenu] = useState<{x:number;y:number;path:string}|null>(null);
  useEffect(() => {
    const close = () => setMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const { parentMap } = React.useMemo(() => buildMaps(root), [root]);

  const getAncestors = (path: string): string[] => {
    const acc: string[] = [];
    let cur: string | null = parentMap.get(path) ?? null;
    while (cur) {
      acc.push(cur);
      cur = parentMap.get(cur) ?? null;
    }
    return acc;
  };

  const collapseOthers = (path: string) => {
    const next = new Set<string>();
    // keep ancestors and the node itself open so it's visible
    for (const p of getAncestors(path)) next.add(p);
    next.add(path);
    onOpenChange(next);
  };

  const findNode = (node: TreeNode, path: string): TreeNode | null => {
    if (node.path === path) return node;
    if (!node.children) return null;
    for (const c of node.children) { const r = findNode(c, path); if (r) return r; }
    return null;
  };
  const collectDescendants = (n: TreeNode, acc: string[] = []): string[] => {
    if (!n.children) return acc;
    for (const c of n.children) { acc.push(c.path); collectDescendants(c, acc); }
    return acc;
  };
  const expandAll = (path: string) => {
    const target = findNode(root, path);
    if (!target) return;
    const next = new Set(open);
    next.add(path);
    for (const p of collectDescendants(target, [])) next.add(p);
    onOpenChange(next);
  };
  const collapseAll = (path: string) => {
    const target = findNode(root, path);
    if (!target) return;
    const next = new Set(open);
    for (const p of collectDescendants(target, [])) next.delete(p);
    next.delete(path);
    onOpenChange(next);
  };

  const Item: React.FC<{ node: TreeNode; depth: number; selected?: string | null }> = ({ node, depth, selected }) => {
    const hasChildren = !!node.children?.length;
    const indent = { paddingLeft: `${depth * 0.75}rem` };
    const isSelected = selected === node.path;
    return (
      <div>
        <div
          className={
            "flex items-center gap-1 py-1 px-2 rounded cursor-pointer " +
            (isSelected ? "bg-neutral-200" : "hover:bg-neutral-100")
          }
          style={indent}
          onClick={() => onSelect(node.path)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenu({ x: e.clientX, y: e.clientY, path: node.path });
          }}
        >
          {hasChildren ? (
            <span
              className="w-4 select-none text-neutral-700"
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.path);
              }}
              title={open.has(node.path) ? "Collapse" : "Expand"}
              role="button"
              aria-label={open.has(node.path) ? "Collapse" : "Expand"}
            >
              {open.has(node.path) ? "▾" : "▸"}
            </span>
          ) : (
            <span className="w-4" />
          )}
          <span className="font-mono text-xs text-neutral-800">
            {node.name}
            {node.type === "value" && (
              <span className="text-neutral-500">: {shortLabel(node.value)}</span>
            )}
          </span>
          {node.type !== "value" && (
            <span className="ml-2 text-[10px] rounded bg-neutral-200 px-1">
              {node.type}
            </span>
          )}
        </div>
        {hasChildren && open.has(node.path) && (
          <div>
            {node.children!.map((c) => (
              <Item key={c.path} node={c} depth={depth + 1} selected={selected} />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full overflow-auto">
      <Item node={root} depth={0} selected={selected} />
      {menu && (
        <div
          className="fixed z-50 bg-white border border-neutral-200 rounded shadow-md text-xs"
          style={{ left: menu.x + 2, top: menu.y + 2 }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="block w-full text-left px-3 py-2 hover:bg-neutral-100" onClick={() => { expandAll(menu.path); setMenu(null); }}>Expand all children</button>
          <button className="block w-full text-left px-3 py-2 hover:bg-neutral-100" onClick={() => { collapseAll(menu.path); setMenu(null); }}>Collapse all children</button>
          <button className="block w-full text-left px-3 py-2 hover:bg-neutral-100" onClick={() => { collapseOthers(menu.path); setMenu(null); }}>Collapse others</button>
        </div>
      )}
    </div>
  );
}

function D3Graph({
  nodes,
  links,
  selected,
  highlightNodes,
  highlightLinks,
  params,
  onNodeClick,
  onNodeDoubleClick,
  onNodeContextMenu,
  onBackgroundClick,
  keepNodes,
  keepLinks,
  hideNonMatches,
}: {
  nodes: GraphNode[];
  links: GraphLink[];
  selected?: string | null;
  highlightNodes?: Set<string>;
  highlightLinks?: Set<string>;
  params: GraphParams;
  onNodeClick?: (path: string) => void;
  onNodeDoubleClick?: (path: string) => void;
  onNodeContextMenu?: (path: string, x: number, y: number) => void;
  onBackgroundClick?: () => void;
  keepNodes?: Set<string>;
  keepLinks?: Set<string>;
  hideNonMatches?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<d3.Simulation<any, any> | null>(null);
  const circleRef = useRef<d3.Selection<SVGCircleElement, any, any, any> | null>(null);
  const linkRef = useRef<d3.Selection<SVGLineElement, any, any, any> | null>(null);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const textRef = useRef<d3.Selection<SVGTextElement, any, any, any> | null>(null);

  // Build / rebuild only when nodes or links change
  useEffect(() => {
    const svg = d3.select(svgRef.current!);
    svg.selectAll("*").remove();

    const width = (svgRef.current?.clientWidth ?? 800);
    const height = (svgRef.current?.clientHeight ?? 600);

    const g = svg.append("g");
    // Apply persisted transform so zoom/pan state is kept across rebuilds
    g.attr("transform", transformRef.current.toString());

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([params.zoomMin, params.zoomMax])
      .on("zoom", (event) => {
        g.attr("transform", event.transform.toString());
        transformRef.current = event.transform;
      });
    svg.call(zoom as any);
    svg.on("dblclick.zoom", null);
    // Background click — do not select or show any path; let parent decide
    svg.on("click", (event) => {
      // Only trigger when clicking the bare SVG, not when a node/link handles it
      if (typeof onBackgroundClick === 'function') {
        onBackgroundClick();
      }
    });
    // Ensure internal zoom state matches persisted transform
    (zoom as any).transform(svg as any, transformRef.current);

    const link = g
      .append("g")
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.3)
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("data-key", (d: any) =>
        `${typeof d.source === 'string' ? d.source : d.source.id ?? d.source.path}->${typeof d.target === 'string' ? d.target : d.target.id ?? d.target.path}`
      )
      .attr("stroke-opacity", (d: any) => {
        const key = `${typeof d.source === 'string' ? d.source : d.source.id ?? d.source.path}->${typeof d.target === 'string' ? d.target : d.target.id ?? d.target.path}`;
        if (highlightLinks && highlightLinks.has(key)) return 0.8;
        if (keepLinks && keepLinks.size > 0 && !keepLinks.has(key)) return 0.08;
        return 0.3;
      })
      .attr("stroke-width", (d: any) => {
        const key = `${typeof d.source === 'string' ? d.source : d.source.id ?? d.source.path}->${typeof d.target === 'string' ? d.target : d.target.id ?? d.target.path}`;
        return (highlightLinks && highlightLinks.has(key)) ? 2.5 : 1.2;
      })
      .style("display", (d: any) => {
        const key = `${typeof d.source === 'string' ? d.source : d.source.id ?? d.source.path}->${typeof d.target === 'string' ? d.target : d.target.id ?? d.target.path}`;
        const keep = !keepLinks || keepLinks.size === 0 || keepLinks.has(key);
        return hideNonMatches && !keep ? 'none' : null;
      });
    linkRef.current = link as any;

    const node = g
      .append("g")
      .selectAll("g.node")
      .data(nodes)
      .enter()
      .append("g")
      .attr("class", "node");

    const circle = node
      .append("circle")
      .attr("r", (d) => {
        return d.type === "value"
          ? params.nodeRadiusValue
          : (d.type === "array" ? params.nodeRadiusArray : params.nodeRadiusObject);
      })
      .attr("fill", (d) => {
        if ((d as any).id === 'root') return '#000000';
        return (d as any).color ?? (d.type === "value" ? "#cbd5e1" : (d.type === "array" ? "#cbd5e1" : "#cbd5e1"));
      })
      .attr("stroke", (d: any) => (selected && d.id === selected ? "#ef4444" : "#334155"))
      .attr("stroke-width", (d: any) => {
        if (selected && d.id === selected) return 3;
        return (highlightNodes && highlightNodes.has(d.id)) ? 2 : 1;
      })
      .attr("opacity", (d: any) => (!keepNodes || keepNodes.size === 0 || keepNodes.has(d.id)) ? 1 : 0.2)
      .style("display", (d: any) => {
        const keep = !keepNodes || keepNodes.size === 0 || keepNodes.has(d.id);
        return hideNonMatches && !keep ? 'none' : null;
      })
      .style("pointer-events", (d: any) => {
        const keep = !keepNodes || keepNodes.size === 0 || keepNodes.has(d.id);
        return hideNonMatches && !keep ? 'none' : null;
      });

    circleRef.current = circle as any;

    const text = node
      .append("text")
      .attr("x", 10)
      .attr("y", 3)
      .attr("font-size", 11)
      .text((d) => shortLabel(d.label, 40))
      .style("display", (d: any) => {
        const keep = !keepNodes || keepNodes.size === 0 || keepNodes.has(d.id);
        return hideNonMatches && !keep ? "none" : null;
      })
      .style("pointer-events", (d: any) => {
        const keep = !keepNodes || keepNodes.size === 0 || keepNodes.has(d.id);
        return hideNonMatches && !keep ? "none" : null;
      });
    textRef.current = text as any;

    const sim = d3
      .forceSimulation(nodes as any)
      .force(
        "link",
        d3
          .forceLink(links as any)
          .id((d: any) => d.id)
          .distance(params.linkDistance)
          .strength(params.linkStrength)
      )
      .force("charge", d3.forceManyBody().strength(params.chargeStrength))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide().radius((d: any) => {
          const base = d.type === "value"
            ? params.nodeRadiusValue
            : (d.type === "array" ? params.nodeRadiusArray : params.nodeRadiusObject);
          return base + params.collisionPadding;
        })
      );

    const drag = d3
      .drag<SVGGElement, any>()
      .on("start", (event, d: any) => {
        if (!event.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d: any) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d: any) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    node.call(drag as any);
    node.on("click", (event, d: any) => {
      event.stopPropagation();
      if (typeof onNodeClick === 'function') {
        onNodeClick(d.id);
      }
    });
    node.on("contextmenu", (event, d: any) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onNodeContextMenu === 'function') {
        onNodeContextMenu(d.id, (event as MouseEvent).clientX, (event as MouseEvent).clientY);
      }
    });
    node.on("dblclick", (event, d: any) => {
      if (typeof onNodeDoubleClick === 'function') {
        onNodeDoubleClick(d.id);
      }
    });

    sim.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    simRef.current = sim;

    return () => {
      sim.stop();
      simRef.current = null;
      circleRef.current = null;
      linkRef.current = null;
      textRef.current = null;
    };
  }, [nodes, links, params, hideNonMatches, keepNodes, keepLinks, highlightNodes, highlightLinks, selected]);

  // Live update forces when params change, without rebuilding SVG
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    const linkForce = sim.force("link") as d3.ForceLink<any, any> | null;
    if (linkForce) {
      linkForce.distance(params.linkDistance).strength(params.linkStrength);
    }
    const chargeForce = sim.force("charge") as d3.ForceManyBody<any> | null;
    if (chargeForce) {
      chargeForce.strength(params.chargeStrength as number);
    }
    const collisionForce = sim.force("collision") as d3.ForceCollide<any> | null;
    if (collisionForce) {
      collisionForce.radius((d: any) => {
        const base = d.type === "value"
          ? params.nodeRadiusValue
          : (d.type === "array" ? params.nodeRadiusArray : params.nodeRadiusObject);
        return base + params.collisionPadding;
      });
    }
    sim.alpha(0.7).restart();
  }, [params]);

  // Update selection and highlight styles for nodes and links
  useEffect(() => {
    if (circleRef.current) {
      circleRef.current
        .attr('stroke', (d: any) => (selected && d.id === selected ? '#ef4444' : '#334155'))
        .attr('stroke-width', (d: any) => {
          if (selected && d.id === selected) return 3;
          return (highlightNodes && highlightNodes.has(d.id)) ? 2 : 1;
        })
        .attr('opacity', (d: any) => (!keepNodes || keepNodes.size === 0 || keepNodes.has(d.id)) ? 1 : 0.2)
        .style('display', (d: any) => {
          const keep = !keepNodes || keepNodes.size === 0 || keepNodes.has(d.id);
          return hideNonMatches && !keep ? 'none' : null;
        })
        .style('pointer-events', (d: any) => {
          const keep = !keepNodes || keepNodes.size === 0 || keepNodes.has(d.id);
          return hideNonMatches && !keep ? 'none' : null;
        });
    }
    if (linkRef.current) {
      linkRef.current
        .attr('stroke-opacity', (d: any) => {
          const key = `${typeof d.source === 'string' ? d.source : d.source.id ?? d.source.path}->${typeof d.target === 'string' ? d.target : d.target.id ?? d.target.path}`;
          if (highlightLinks && highlightLinks.has(key)) return 0.8;
          if (keepLinks && keepLinks.size > 0 && !keepLinks.has(key)) return 0.08;
          return 0.3;
        })
        .attr('stroke-width', (d: any) => {
          const key = `${typeof d.source === 'string' ? d.source : d.source.id ?? d.source.path}->${typeof d.target === 'string' ? d.target : d.target.id ?? d.target.path}`;
          return (highlightLinks && highlightLinks.has(key)) ? 2.5 : 1.2;
        })
        .style('display', (d: any) => {
          const key = `${typeof d.source === 'string' ? d.source : d.source.id ?? d.source.path}->${typeof d.target === 'string' ? d.target : d.target.id ?? d.target.path}`;
          const keep = !keepLinks || keepLinks.size === 0 || keepLinks.has(key);
          return hideNonMatches && !keep ? 'none' : null;
        });
    }
    if (textRef.current) {
      textRef.current
        .style("display", (d: any) => {
          const keep = !keepNodes || keepNodes.size === 0 || keepNodes.has(d.id);
          return hideNonMatches && !keep ? "none" : null;
        })
        .style("pointer-events", (d: any) => {
          const keep = !keepNodes || keepNodes.size === 0 || keepNodes.has(d.id);
          return hideNonMatches && !keep ? "none" : null;
        });
    }
  }, [selected, highlightNodes, highlightLinks, keepNodes, keepLinks, hideNonMatches, nodes, links]);

  return <svg ref={svgRef} className="w-full h-full text-neutral-600" />;
}

// --------------------------- Main ---------------------------


const SAMPLE = {
  name: "Example",
  users: [
    { id: 1, name: "Alice", tags: ["admin", "editor"] },
    { id: 2, name: "Bob", active: true },
  ],
  settings: { theme: "light", version: 1 },
};

const DEFAULT_PARAMS: GraphParams = {
  linkDistance: 30,
  linkStrength: 1,
  chargeStrength: -60,
  collisionPadding: 4,
  nodeRadiusValue: 4,
  nodeRadiusArray: 8,
  nodeRadiusObject: 8,
  zoomMin: 0.1,
  zoomMax: 3,
};

export default function App() {
  const [json, setJson] = useState<any>(SAMPLE);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openSet, setOpenSet] = useState<Set<string>>(() => new Set()); // 기본: 전체 닫기

  const [graphParams, setGraphParams] = useState<GraphParams>(DEFAULT_PARAMS);

  // Sidebar width state and layout ref for resizing
  const [sidebarWidth, setSidebarWidth] = useState<number>(320);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const layoutRef = React.useRef<HTMLDivElement | null>(null);
  const isDraggingRef = React.useRef(false);

  // Graph context menu state
  const [graphMenu, setGraphMenu] = useState<{x:number;y:number;path:string}|null>(null);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  // --- Filter state ---
  type Filter = { id: string; query: string; byKey: boolean; byValue: boolean };
  const [filterText, setFilterText] = useState<string>('');
  const [filterByKey, setFilterByKey] = useState<boolean>(true);
  const [filterByValue, setFilterByValue] = useState<boolean>(false);
  const [filters, setFilters] = useState<Filter[]>([]);
  const addFilter = () => {
    const q = filterText.trim();
    if (!q) return;
    if (!filterByKey && !filterByValue) return;
    const f: Filter = { id: String(Date.now()) + Math.random().toString(36).slice(2), query: q, byKey: filterByKey, byValue: filterByValue };
    setFilters(prev => [...prev, f]);
    setFilterText('');
  };
  const removeFilter = (id: string) => setFilters(prev => prev.filter(f => f.id !== id));
  const [hideNonMatches, setHideNonMatches] = useState<boolean>(false);
  // Ref for the graph container
  const graphContainerRef = React.useRef<HTMLDivElement | null>(null);
  // Sidebar resize handlers
  const startResize = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const rect = layoutRef.current?.getBoundingClientRect();
      if (!rect) return;
      const raw = ev.clientX - rect.left;
      const min = 200; // minimum px for sidebar
      const max = Math.min(rect.width - 240, 800); // keep room for main; cap at 800
      const next = Math.max(min, Math.min(raw, max));
      setSidebarWidth(next);
    };
    const onUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    const close = () => setGraphMenu(null);
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setGraphMenu(null); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const tree = useMemo(() => jsonToTree(json), [json]);
  const { parentMap, nodeMap } = useMemo(() => buildMaps(tree), [tree]);
  const breadcrumbPaths = useMemo(() => {
    if (!selectedPath) return [] as string[];
    const acc: string[] = [];
    let cur: string | null = selectedPath;
    while (cur) {
      acc.push(cur);
      cur = parentMap.get(cur) ?? null;
    }
    return acc.reverse();
  }, [selectedPath, parentMap]);

  const baseGraph = useMemo(() => treeToGraph(tree), [tree]);

  // 왼쪽 트리에 보이는 노드 계산(root는 항상 보임)
  const visibleSet = useMemo(() => {
    const v = new Set<string>();
    v.add(tree.path);
    for (const p of parentMap.keys()) {
      if (p === tree.path) continue;
      let cur = parentMap.get(p) ?? null;
      let ok = true;
      while (cur) {
        if (!openSet.has(cur)) { ok = false; break; }
        cur = parentMap.get(cur) ?? null;
      }
      if (ok) v.add(p);
    }
    return v;
  }, [parentMap, openSet, tree.path]);

  // 보이는 노드만 그래프에 반영
  const { nodes, links } = useMemo(() => {
    const n = baseGraph.nodes.filter(n => visibleSet.has(n.id));
    const nodeSet = new Set(n.map(x => x.id));
    const getId = (s: any) => (typeof s === 'string' ? s : (s?.id ?? s?.path));
    const l = baseGraph.links
      .filter(l => nodeSet.has(getId(l.source)) && nodeSet.has(getId(l.target)))
      // re-materialize to plain ids to avoid downstream mutation side-effects
      .map(l => ({ source: getId(l.source), target: getId(l.target) }));
    return { nodes: n, links: l };
  }, [baseGraph, visibleSet]);

  // Compute pathNodeSet and pathLinkSet for highlighting
  const pathNodeSet = useMemo(() => {
    if (!selectedPath) return undefined;
    const s = new Set<string>();
    let cur: string | null = selectedPath;
    while (cur) {
      s.add(cur);
      const p = parentMap.get(cur) ?? null;
      cur = p;
    }
    return s;
  }, [selectedPath, parentMap]);

  const pathLinkSet = useMemo(() => {
    if (!selectedPath) return undefined;
    const s = new Set<string>();
    let child: string | null = selectedPath;
    let parent = parentMap.get(child) ?? null;
    while (parent) {
      s.add(`${parent}->${child}`);
      child = parent;
      parent = parentMap.get(child) ?? null;
    }
    return s;
  }, [selectedPath, parentMap]);

  // Compute filter keep sets (nodes to keep fully visible and links along root→match paths)
  const { keepNodeSet, keepLinkSet } = useMemo(() => {
    if (filters.length === 0) return { keepNodeSet: undefined, keepLinkSet: undefined } as { keepNodeSet?: Set<string>; keepLinkSet?: Set<string> };
    const matches = new Set<string>();
    // Match by key/value
    nodeMap.forEach((t) => {
      for (const f of filters) {
        const q = f.query.toLowerCase();
        const keyHit = f.byKey && t.name?.toLowerCase().includes(q);
        const valHit = f.byValue && t.type === 'value' && JSON.stringify(t.value ?? '').toLowerCase().includes(q);
        if (keyHit || valHit) { matches.add(t.path); break; }
      }
    });
    const keepNodes = new Set<string>();
    const keepLinks = new Set<string>();
    const addPath = (leaf: string) => {
      let child: string | null = leaf;
      let parent = parentMap.get(child) ?? null;
      keepNodes.add(child);
      while (parent) {
        keepNodes.add(parent);
        keepLinks.add(`${parent}->${child}`);
        child = parent;
        parent = parentMap.get(child) ?? null;
      }
    };
    for (const m of matches) addPath(m);
    return { keepNodeSet: keepNodes, keepLinkSet: keepLinks };
  }, [filters, nodeMap, parentMap]);
  
  const findTreeNode = (node: TreeNode, path: string): TreeNode | null => {
    if (node.path === path) return node;
    if (!node.children) return null;
    for (const c of node.children) {
      const r = findTreeNode(c, path);
      if (r) return r;
    }
    return null;
  };

  const collectDescendantPaths = (n: TreeNode, acc: string[] = []): string[] => {
    if (!n.children) return acc;
    for (const c of n.children) {
      acc.push(c.path);
      collectDescendantPaths(c, acc);
    }
    return acc;
  };

  // --- Helpers for context menu actions ---
  const getAncestors = (path: string): string[] => {
    const acc: string[] = [];
    let cur: string | null = parentMap.get(path) ?? null;
    while (cur) { acc.push(cur); cur = parentMap.get(cur) ?? null; }
    return acc;
  };

  const expandAll = (path: string) => {
    const target = findTreeNode(tree, path);
    if (!target) return;
    const next = new Set(openSet);
    next.add(path);
    for (const p of collectDescendantPaths(target, [])) next.add(p);
    setOpenSet(next);
  };

  const collapseAll = (path: string) => {
    const target = findTreeNode(tree, path);
    if (!target) return;
    const next = new Set(openSet);
    for (const p of collectDescendantPaths(target, [])) next.delete(p);
    next.delete(path);
    setOpenSet(next);
  };

  const collapseOthers = (path: string) => {
    const next = new Set<string>();
    for (const p of getAncestors(path)) next.add(p);
    next.add(path);
    setOpenSet(next);
  };

  const handleResetNodeSettings = () => {
    setGraphParams(DEFAULT_PARAMS);
    setSelectedPath(null);
  };

  const handleGraphNodeDblClick = (path: string) => {
    // If already open, collapse this node and all its descendants; else open this node
    if (openSet.has(path)) {
      const target = findTreeNode(tree, path);
      if (!target) return;
      const next = new Set(openSet);
      for (const p of collectDescendantPaths(target, [])) next.delete(p);
      next.delete(path);
      setOpenSet(next);
    } else {
      setOpenSet(prev => {
        const next = new Set(prev);
        next.add(path);
        return next;
      });
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-white text-neutral-900">
      {/* Header */}
      <div className="border-b border-neutral-200 px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="text-sm font-semibold">Jraph</div>
        </div>
        <div className="hidden md:flex items-center gap-3 text-xs" />
        <UploadJson onLoad={setJson} />
      </div>


      {/* Breadcrumb: root > ... > */}
      <div className="border-b border-neutral-200 px-4 py-1 text-xs text-neutral-700 overflow-x-auto whitespace-nowrap">
        {(
          (breadcrumbPaths.length ? breadcrumbPaths : ['root'])
        ).map((p, idx, arr) => (
          <React.Fragment key={p}>
            <button
              className="hover:underline disabled:no-underline disabled:text-neutral-400 cursor-pointer"
              onClick={() => setSelectedPath(p)}
              disabled={arr.length === 1 && p === 'root'}
              title={nodeMap.get(p)?.path || p}
            >
              <span className="font-mono">{nodeMap.get(p)?.name || p}</span>
            </button>
            {idx < arr.length - 1 && <span className="mx-1 font-mono">&gt;</span>}
          </React.Fragment>
        ))}
      </div>
      {/* Filter Bar */}
      <div className="border-b border-neutral-200 px-4 py-2 text-xs flex items-center gap-3">
        <input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Filter query…"
          className="px-2 py-1 border border-neutral-300 rounded w-64"
          onKeyDown={(e) => { if (e.key === 'Enter') addFilter(); }}
        />
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={filterByKey} onChange={(e) => setFilterByKey(e.target.checked)} />
          key
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={filterByValue} onChange={(e) => setFilterByValue(e.target.checked)} />
          value
        </label>
        <button className="px-2 py-1 border border-neutral-300 rounded hover:bg-neutral-50" onClick={addFilter}>Add</button>
        <label className="inline-flex items-center gap-1 ml-2">
          <input
            type="checkbox"
            checked={hideNonMatches}
            onChange={(e) => setHideNonMatches(e.target.checked)}
          />
          hide non-matching
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          {filters.map(f => (
            <span key={f.id} className="inline-flex items-center gap-2 px-2 py-1 rounded border border-neutral-300 bg-white">
              <span className="font-mono">{f.query}</span>
              <span className="text-[10px] text-neutral-600">
                [{[f.byKey ? 'key' : null, f.byValue ? 'value' : null].filter(Boolean).join('+')}]
              </span>
              <button className="text-neutral-500 hover:text-neutral-800" onClick={() => removeFilter(f.id)}>×</button>
            </span>
          ))}
        </div>
      </div>
      {/* Body */}
      <div
        ref={layoutRef}
        className="flex-1 grid h-0 select-none transition-[grid-template-columns] duration-300 ease-in-out"
        style={{ gridTemplateColumns: sidebarOpen ? `48px ${sidebarWidth}px 4px 1fr` : `48px 0px 0px 1fr` }}
      >
        {/* Far Left: Menu column */}
        <aside className="col-[1] border-r border-neutral-200 bg-white">
          <div className="flex h-full flex-col items-center gap-2 p-2 w-12">
            <button
              className="inline-flex items-center justify-center w-9 h-9 border border-neutral-300 rounded-md bg-white shadow-sm hover:bg-neutral-50"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label={sidebarOpen ? 'Hide JSON tree' : 'Show JSON tree'}
              title={sidebarOpen ? 'Hide JSON tree' : 'Show JSON tree'}
            >
              <Menu size={18} />
            </button>
            <button
              className="inline-flex items-center justify-center w-9 h-9 border border-neutral-300 rounded-md bg-white shadow-sm hover:bg-neutral-50"
              onClick={() => expandAll('root')}
              aria-label="Expand all"
              title="Expand all (root)"
            >
              <Maximize2 size={18} />
            </button>
            <button
              className="inline-flex items-center justify-center w-9 h-9 border border-neutral-300 rounded-md bg-white shadow-sm hover:bg-neutral-50"
              onClick={() => collapseAll('root')}
              aria-label="Collapse all"
              title="Collapse all (root)"
            >
              <Minimize2 size={18} />
            </button>
            <div className="flex-1" />
            <button
              className="inline-flex items-center justify-center w-9 h-9 border border-neutral-300 rounded-md bg-white shadow-sm hover:bg-neutral-50"
              onClick={() => setSettingsOpen(v => !v)}
              aria-label="Settings"
              title="Settings (bottom left)"
            >
              <Settings size={18} />
            </button>
          </div>
        </aside>
        {/* Left: Tree */}
        <aside
          className="border-r border-neutral-200 overflow-auto col-[2] transition-opacity duration-300"
          style={{ opacity: sidebarOpen ? 1 : 0, pointerEvents: sidebarOpen ? 'auto' : 'none' }}
        >
          <div className="p-2">
            <TreeView root={tree} onSelect={setSelectedPath} selected={selectedPath} open={openSet} onOpenChange={setOpenSet} />
          </div>
        </aside>

        {/* Resizer */}
        <div
          className="col-[3] cursor-col-resize bg-neutral-200 hover:bg-neutral-300 transition-opacity duration-300"
          onMouseDown={startResize}
          title="Drag to resize"
          style={{ opacity: sidebarOpen ? 1 : 0, pointerEvents: sidebarOpen ? 'auto' : 'none' }}
        />

        {/* Right: Graph */}
        <main ref={graphContainerRef} className="relative overflow-hidden col-[4]">
          <D3Graph
            nodes={nodes}
            links={links}
            selected={selectedPath}
            highlightNodes={pathNodeSet}
            highlightLinks={pathLinkSet}
            params={graphParams}
            keepNodes={keepNodeSet}
            keepLinks={keepLinkSet}
            hideNonMatches={hideNonMatches}
            onNodeClick={(path) => { setSelectedPath(path); setGraphMenu(null); }}
            onNodeDoubleClick={handleGraphNodeDblClick}
            onNodeContextMenu={(path, x, y) => {
              const rect = graphContainerRef.current?.getBoundingClientRect();
              const localX = rect ? x - rect.left : x;
              const localY = rect ? y - rect.top : y;
              setGraphMenu({ path, x: localX, y: localY });
            }}
            onBackgroundClick={() => { setSelectedPath(null); setGraphMenu(null); }}
          />
          {graphMenu && (
            <div
              className="absolute z-50 bg-white border border-neutral-200 rounded shadow-md text-xs"
              style={{ left: graphMenu.x + 2, top: graphMenu.y + 2 }}
              onClick={(e) => e.stopPropagation()}
            >
              <button className="block w-full text-left px-3 py-2 hover:bg-neutral-100" onClick={() => { expandAll(graphMenu.path); setGraphMenu(null); }}>Expand all children</button>
              <button className="block w-full text-left px-3 py-2 hover:bg-neutral-100" onClick={() => { collapseAll(graphMenu.path); setGraphMenu(null); }}>Collapse all children</button>
              <button className="block w-full text-left px-3 py-2 hover:bg-neutral-100" onClick={() => { collapseOthers(graphMenu.path); setGraphMenu(null); }}>Collapse others</button>
            </div>
          )}
          <div className="absolute bottom-2 right-2 pointer-events-none text-[10px] text-neutral-400">
            drag nodes • scroll to zoom • click tree to highlight • right-click tree to expand/collapse
          </div>
        </main>
      </div>
      {settingsOpen && (
        <div className="fixed left-14 bottom-2 z-50">
          <div className="bg-white border border-neutral-200 rounded-lg shadow-lg p-3 w-[300px]">
            <div className="text-xs font-semibold mb-2">Graph Settings</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="flex items-center gap-1">dist
                <input
                  type="number"
                  className="w-20 border border-neutral-300 rounded px-1 py-0.5"
                  value={graphParams.linkDistance}
                  onChange={(e) => setGraphParams(p => ({ ...p, linkDistance: Number(e.target.value) }))}
                />
              </label>
              <label className="flex items-center gap-1">str
                <input
                  type="number"
                  step={0.1}
                  className="w-16 border border-neutral-300 rounded px-1 py-0.5"
                  value={graphParams.linkStrength}
                  onChange={(e) => setGraphParams(p => ({ ...p, linkStrength: Number(e.target.value) }))}
                />
              </label>
              <label className="flex items-center gap-1">charge
                <input
                  type="number"
                  className="w-24 border border-neutral-300 rounded px-1 py-0.5"
                  value={graphParams.chargeStrength}
                  onChange={(e) => setGraphParams(p => ({ ...p, chargeStrength: Number(e.target.value) }))}
                />
              </label>
              <label className="flex items-center gap-1">collide
                <input
                  type="number"
                  className="w-16 border border-neutral-300 rounded px-1 py-0.5"
                  value={graphParams.collisionPadding}
                  onChange={(e) => setGraphParams(p => ({ ...p, collisionPadding: Number(e.target.value) }))}
                />
              </label>
              <label className="flex items-center gap-1">r(val)
                <input
                  type="number"
                  className="w-16 border border-neutral-300 rounded px-1 py-0.5"
                  value={graphParams.nodeRadiusValue}
                  onChange={(e) => setGraphParams(p => ({ ...p, nodeRadiusValue: Number(e.target.value) }))}
                />
              </label>
              <label className="flex items-center gap-1">r(arr)
                <input
                  type="number"
                  className="w-16 border border-neutral-300 rounded px-1 py-0.5"
                  value={graphParams.nodeRadiusArray}
                  onChange={(e) => setGraphParams(p => ({ ...p, nodeRadiusArray: Number(e.target.value) }))}
                />
              </label>
              <label className="flex items-center gap-1">r(obj)
                <input
                  type="number"
                  className="w-16 border border-neutral-300 rounded px-1 py-0.5"
                  value={graphParams.nodeRadiusObject}
                  onChange={(e) => setGraphParams(p => ({ ...p, nodeRadiusObject: Number(e.target.value) }))}
                />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-end">
              <button
                className="px-2 py-1 border border-neutral-300 rounded hover:bg-neutral-50 text-[11px]"
                onClick={handleResetNodeSettings}
                title="Reset node radii and selection"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
