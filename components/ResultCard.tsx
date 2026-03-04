"use client";

import { Clock, Tag, ChevronDown, ChevronUp, ArrowRight, User, HardDrive, Server, KeySquare, MonitorDot, Play, Database, BarChart3, Radio, Lock, Flame, ShieldAlert, Users } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import type { QueryResult } from "./QueryBox";
import type { ResourceItem } from "@/lib/claude/query-processor";

interface ResultCardProps {
  result: QueryResult;
  index: number;
}

type IntentLink = { href: string; label: string; Icon: React.ElementType };

import { RESOURCE_LINKS, getResourceHref, linkifyText } from "@/lib/utils/linkify";

function buildLinks(intent: QueryResult["intent"]): IntentLink[] {
  const links: IntentLink[] = [];
  if (intent.user) {
    links.push({ href: `/dashboard/principal?email=${encodeURIComponent(intent.user)}`, label: intent.user, Icon: User });
  }
  if (intent.queryType === "security_findings") {
    links.push({ href: "/dashboard/findings", label: "Security Findings", Icon: ShieldAlert });
  }
  if (intent.queryType === "list_users") {
    links.push({ href: "/dashboard/users", label: "Users", Icon: Users });
  }
  if (intent.resourceType && RESOURCE_LINKS[intent.resourceType]) {
    const { path, label, Icon } = RESOURCE_LINKS[intent.resourceType];
    links.push({ href: path, label, Icon });
  }
  return links;
}

// Local helpers now use shared utility
function resourceHref(item: ResourceItem): string {
  return getResourceHref(item);
}

function linkifyResources(text: string, resources: ResourceItem[]): string {
  return linkifyText(text, resources, resourceHref);
}

function ResourceIcon({ type }: { type: ResourceItem["type"] }) {
  const cfg = RESOURCE_LINKS[type ?? ""];
  if (!cfg) return null;
  return <cfg.Icon className="w-3 h-3 shrink-0" style={{ color: "#005c16" }} />;
}

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n/g, "<br />");
}

const CHIP_LIMIT = 12;

export default function ResultCard({ result, index }: ResultCardProps) {
  const [showIntent, setShowIntent] = useState(false);
  const [showAllResources, setShowAllResources] = useState(false);
  const links = buildLinks(result.intent);
  const resources = result.resources ?? [];
  const visibleResources = showAllResources ? resources : resources.slice(0, CHIP_LIMIT);
  const hasMore = resources.length > CHIP_LIMIT;

  return (
    <div
      data-nav
      tabIndex={0}
      style={{ border: "1px solid #005c16", background: "#0a0a0a" }}
    >
      {/* Header */}
      <div
        className="px-3 md:px-4 py-2 flex flex-col sm:flex-row sm:items-center justify-between text-[10px] md:text-xs gap-2"
        style={{ borderBottom: "1px solid #0a1a0a" }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: "#005c16" }}>#{String(index + 1).padStart(2, "0")}</span>
          <span className="truncate max-w-[200px] md:max-w-none" style={{ color: "#00ff41" }}>$ {result.query}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline" style={{ color: "#005c16" }}>
            {result.intent.queryType.replace(/_/g, " ")}
          </span>
          <span style={{ color: "#005c16" }}>
            <Clock className="w-3 h-3 inline mr-1" />
            {new Date(result.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Answer */}
      <div className="px-3 md:px-4 py-3">
        <div
          className="prose-answer text-xs md:text-sm leading-relaxed break-words"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(linkifyResources(result.answer, resources)) }}
        />
      </div>

      {/* Resource chips */}
      {resources.length > 0 && (
        <div className="px-4 pb-3 space-y-2">
          <p className="text-xs uppercase tracking-widest" style={{ color: "#005c16" }}>
            // {resources.length} resource{resources.length !== 1 ? "s" : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {visibleResources.map((item) => (
              <Link
                key={`${item.projectId}/${item.name}`}
                href={resourceHref(item)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs max-w-[260px] transition-all"
                style={{ border: "1px solid #003010", color: "#00aa2b" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = "#00ff41";
                  (e.currentTarget as HTMLAnchorElement).style.color = "#00ff41";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = "#003010";
                  (e.currentTarget as HTMLAnchorElement).style.color = "#00aa2b";
                }}
              >
                <ResourceIcon type={item.type} />
                <span className="truncate">{item.name}</span>
                {item.extra && <span style={{ color: "#005c16" }}>{item.extra}</span>}
              </Link>
            ))}
            {hasMore && !showAllResources && (
              <button
                onClick={() => setShowAllResources(true)}
                className="px-2 py-1 text-xs"
                style={{ border: "1px solid #003010", color: "#005c16" }}
              >
                +{resources.length - CHIP_LIMIT} more
              </button>
            )}
            {showAllResources && hasMore && (
              <button
                onClick={() => setShowAllResources(false)}
                className="px-2 py-1 text-xs"
                style={{ color: "#005c16" }}
              >
                // collapse
              </button>
            )}
          </div>
        </div>
      )}

      {/* Jump-to links */}
      {links.length > 0 && (
        <div
          className="px-4 py-2 flex items-center gap-2 flex-wrap text-xs"
          style={{ borderTop: "1px solid #0a1a0a" }}
        >
          <span style={{ color: "#005c16" }}>// navigate:</span>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-1.5 px-2 py-1 transition-all"
              style={{ border: "1px solid #003010", color: "#00aa2b" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "#00ff41";
                (e.currentTarget as HTMLAnchorElement).style.color = "#00ff41";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLAnchorElement).style.borderColor = "#003010";
                (e.currentTarget as HTMLAnchorElement).style.color = "#00aa2b";
              }}
            >
              <link.Icon className="w-3 h-3 shrink-0" />
              <span className="truncate">[{link.label}]</span>
              <ArrowRight className="w-3 h-3 shrink-0 opacity-50" />
            </Link>
          ))}
        </div>
      )}

      {/* Intent debug */}
      <div
        className="px-4 py-1.5 flex items-center"
        style={{ borderTop: "1px solid #0a1a0a" }}
      >
        <button
          onClick={() => setShowIntent(!showIntent)}
          className="flex items-center gap-1 text-xs transition-colors"
          style={{ color: "#003010" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#005c16"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#003010"; }}
        >
          <Tag className="w-3 h-3" />
          {showIntent ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          // debug intent
        </button>
      </div>

      {showIntent && (
        <div className="px-4 pb-3">
          <pre
            className="text-xs overflow-x-auto p-3"
            style={{ background: "#050505", color: "#00aa2b", border: "1px solid #003010" }}
          >
            {JSON.stringify(result.intent, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
