/**
 * D3.js Delegation Chain Visualization
 */

import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

interface DelegationNode {
  id: string;
  name: string;
  type: 'agent' | 'delegation';
  status: 'active' | 'revoked' | 'expired';
  depth: number;
  permissions?: string[];
  constraints?: Record<string, any>;
}

interface DelegationLink {
  source: string;
  target: string;
  type: 'delegation';
  createdAt: string;
  expiresAt?: string;
}

interface DelegationGraphProps {
  nodes: DelegationNode[];
  links: DelegationLink[];
  width?: number;
  height?: number;
  onNodeClick?: (node: DelegationNode) => void;
  onLinkClick?: (link: DelegationLink) => void;
}

export function DelegationGraph({
  nodes,
  links,
  width = 800,
  height = 600,
  onNodeClick,
  onLinkClick,
}: DelegationGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', [0, 0, width, height])
      .attr('style', 'max-width: 100%; height: auto;');

    // Create arrow marker
    svg.append('defs').append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 25)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M 0,-5 L 10,0 L 0,5')
      .attr('fill', '#6b7280');

    // Create force simulation
    const simulation = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links as any)
        .id((d: any) => d.id)
        .distance(150))
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(50));

    // Create container for zoom
    const container = svg.append('g');

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        container.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Create links
    const link = container.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#6b7280')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', 2)
      .attr('marker-end', 'url(#arrowhead)')
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        onLinkClick?.(d);
      });

    // Create node groups
    const node = container.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer')
      .call(d3.drag<SVGGElement, DelegationNode>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended) as any);

    // Add circles for nodes
    node.append('circle')
      .attr('r', (d) => d.type === 'agent' ? 25 : 20)
      .attr('fill', (d) => {
        if (d.status === 'revoked') return '#ef4444';
        if (d.status === 'expired') return '#f59e0b';
        return d.type === 'agent' ? '#3b82f6' : '#10b981';
      })
      .attr('stroke', (d) => selectedNode === d.id ? '#1d4ed8' : '#fff')
      .attr('stroke-width', (d) => selectedNode === d.id ? 3 : 2);

    // Add icons
    node.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', '#fff')
      .attr('font-size', '14px')
      .text((d) => d.type === 'agent' ? '🤖' : '🔑');

    // Add labels
    node.append('text')
      .attr('x', 0)
      .attr('y', 40)
      .attr('text-anchor', 'middle')
      .attr('fill', '#374151')
      .attr('font-size', '12px')
      .attr('font-weight', '500')
      .text((d) => d.name.length > 15 ? d.name.slice(0, 15) + '...' : d.name);

    // Add status badge
    node.filter((d) => d.status !== 'active')
      .append('circle')
      .attr('cx', 18)
      .attr('cy', -18)
      .attr('r', 8)
      .attr('fill', (d) => d.status === 'revoked' ? '#ef4444' : '#f59e0b');

    // Click handler
    node.on('click', (event, d) => {
      event.stopPropagation();
      setSelectedNode(d.id);
      onNodeClick?.(d);
    });

    // Simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    // Drag functions
    function dragstarted(event: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: any) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: any) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [nodes, links, width, height, selectedNode, onNodeClick, onLinkClick]);

  return (
    <div className="relative bg-gray-50 rounded-lg border border-gray-200">
      <svg ref={svgRef} className="w-full" style={{ height: `${height}px` }} />
      
      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-white p-3 rounded-lg shadow-sm border border-gray-200">
        <div className="text-xs font-medium text-gray-700 mb-2">Legend</div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-blue-500" />
            <span className="text-xs text-gray-600">Agent</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-green-500" />
            <span className="text-xs text-gray-600">Delegation</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-red-500" />
            <span className="text-xs text-gray-600">Revoked</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-yellow-500" />
            <span className="text-xs text-gray-600">Expired</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="absolute top-4 right-4 flex gap-2">
        <button
          onClick={() => {
            const svg = d3.select(svgRef.current);
            svg.transition().duration(500).call(
              d3.zoom<SVGSVGElement, unknown>().transform as any,
              d3.zoomIdentity
            );
          }}
          className="px-3 py-1 bg-white text-gray-700 text-sm rounded border border-gray-200 hover:bg-gray-50"
        >
          Reset View
        </button>
      </div>
    </div>
  );
}

// Hierarchical tree view for delegation chains
interface DelegationTreeProps {
  data: any;
  onNodeSelect?: (node: any) => void;
}

export function DelegationTree({ data, onNodeSelect }: DelegationTreeProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const width = 800;
  const height = 500;

  useEffect(() => {
    if (!svgRef.current || !data) return;

    d3.select(svgRef.current).selectAll('*').remove();

    const svg = d3.select(svgRef.current)
      .attr('viewBox', [0, 0, width, height]);

    const root = d3.hierarchy(data);
    const treeLayout = d3.tree<any>().size([width - 100, height - 100]);
    treeLayout(root);

    const container = svg.append('g')
      .attr('transform', 'translate(50, 50)');

    // Links
    container.selectAll('path')
      .data(root.links())
      .join('path')
      .attr('d', d3.linkVertical<any, any>()
        .x(d => d.x)
        .y(d => d.y))
      .attr('fill', 'none')
      .attr('stroke', '#6b7280')
      .attr('stroke-width', 2);

    // Nodes
    const nodes = container.selectAll('g')
      .data(root.descendants())
      .join('g')
      .attr('transform', d => `translate(${d.x},${d.y})`)
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        onNodeSelect?.(d.data);
      });

    nodes.append('circle')
      .attr('r', 20)
      .attr('fill', d => d.depth === 0 ? '#3b82f6' : '#10b981')
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);

    nodes.append('text')
      .attr('dy', 35)
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('fill', '#374151')
      .text(d => d.data.name || d.data.id?.slice(0, 8));

  }, [data, onNodeSelect]);

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <svg ref={svgRef} className="w-full" style={{ height: `${height}px` }} />
    </div>
  );
}
