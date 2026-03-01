"use client";

import { Clock, Tag, ChevronDown, ChevronUp, ArrowRight, User, HardDrive, Server, KeySquare, MonitorDot, Play, Database, BarChart3, Radio, Lock, Flame, ShieldAlert, Users } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { QueryResult } from "./QueryBox";

interface ResultCardProps {
  result: QueryResult;
  index: number;
}

type IntentLink = { href: string; label: string; Icon: React.ElementType };

const RESOURCE_LINKS: Record<string, Omit<IntentLink, "href"> & { path: string }> = {
  bucket:          { path: "/dashboard/buckets",          label: "Buckets",          Icon: HardDrive },
  gke_cluster:     { path: "/dashboard/clusters",         label: "GKE Clusters",     Icon: Server },
  service_account: { path: "/dashboard/service-accounts", label: "Service Accounts", Icon: KeySquare },
  vm:              { path: "/dashboard/vms",              label: "VMs",              Icon: MonitorDot },
  cloud_run:       { path: "/dashboard/cloud-run",        label: "Cloud Run",        Icon: Play },
  cloud_sql:       { path: "/dashboard/cloud-sql",        label: "Cloud SQL",        Icon: Database },
  bigquery:        { path: "/dashboard/bigquery",         label: "BigQuery",         Icon: BarChart3 },
  pubsub:          { path: "/dashboard/pubsub",           label: "Pub/Sub",          Icon: Radio },
  secret:          { path: "/dashboard/secrets",          label: "Secrets",          Icon: Lock },
  firewall:        { path: "/dashboard/firewall",         label: "Firewall Rules",   Icon: Flame },
};

function buildLinks(intent: QueryResult["intent"]): IntentLink[] {
  const links: IntentLink[] = [];

  if (intent.user) {
    links.push({
      href: `/dashboard/principal?email=${encodeURIComponent(intent.user)}`,
      label: intent.user,
      Icon: User,
    });
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

const INTENT_COLORS: Record<string, string> = {
  user_access: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  resource_owners: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  specific_resource_access: "text-sky-400 bg-sky-500/10 border-sky-500/20",
  list_users: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  list_resources: "text-teal-400 bg-teal-500/10 border-teal-500/20",
  unknown: "text-slate-400 bg-slate-500/10 border-slate-500/20",
};

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n/g, "<br />");
}

export default function ResultCard({ result, index }: ResultCardProps) {
  const [showIntent, setShowIntent] = useState(false);
  const intentColor =
    INTENT_COLORS[result.intent.queryType] ?? INTENT_COLORS.unknown;
  const links = buildLinks(result.intent);

  return (
    <div className="glass rounded-2xl overflow-hidden animate-in slide-in-from-top-2 duration-300">
      {/* Header */}
      <div className="px-5 py-3 border-b border-slate-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-500">#{index + 1}</span>
          <p className="text-sm text-slate-300 font-medium line-clamp-1">
            {result.query}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              "px-2 py-0.5 rounded-md text-xs font-medium border",
              intentColor
            )}
          >
            {result.intent.queryType.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* Answer */}
      <div className="px-5 py-4">
        <div
          className="prose-answer text-sm"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(result.answer) }}
        />
      </div>

      {/* Quick links */}
      {links.length > 0 && (
        <div className="px-5 py-2.5 border-t border-slate-700/30 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-600 shrink-0">Jump to</span>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-slate-800 border border-slate-700/50 text-slate-300 hover:border-sky-500/40 hover:text-sky-300 transition-all duration-150 max-w-[260px]"
            >
              <link.Icon className="w-3 h-3 shrink-0 text-slate-500" />
              <span className="truncate">{link.label}</span>
              <ArrowRight className="w-3 h-3 shrink-0 opacity-50" />
            </Link>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="px-5 py-2 border-t border-slate-700/30 flex items-center justify-between">
        <button
          onClick={() => setShowIntent(!showIntent)}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-400 transition-colors"
        >
          <Tag className="w-3 h-3" />
          {showIntent ? "Hide" : "Show"} intent
          {showIntent ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>
        <div className="flex items-center gap-1 text-xs text-slate-600">
          <Clock className="w-3 h-3" />
          {new Date(result.fetchedAt).toLocaleTimeString()}
        </div>
      </div>

      {/* Expandable intent debug */}
      {showIntent && (
        <div className="px-5 pb-4">
          <pre className="text-xs text-slate-400 bg-slate-800/60 rounded-xl p-3 overflow-x-auto border border-slate-700/30 font-mono">
            {JSON.stringify(result.intent, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
