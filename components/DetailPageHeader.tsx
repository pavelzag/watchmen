"use client";

import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";

interface DetailPageHeaderProps {
  title: string;
  count: number | null;
  search: string;
  onSearch: (v: string) => void;
  projects?: string[];
  projectFilter?: string;
  onProjectFilter?: (v: string) => void;
}

export default function DetailPageHeader({
  title, count, search, onSearch, projects, projectFilter, onProjectFilter,
}: DetailPageHeaderProps) {
  return (
    <div className="flex items-center gap-3 mb-6 flex-wrap">
      <Link
        href="/dashboard"
        className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors shrink-0"
      >
        <ArrowLeft className="w-4 h-4" />
        Dashboard
      </Link>
      <div className="flex-1 flex items-center gap-3 min-w-0">
        <h1 className="text-lg font-semibold text-white truncate">{title}</h1>
        {count !== null && (
          <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-300 shrink-0">
            {count}
          </span>
        )}
      </div>
      {projects && projects.length > 1 && onProjectFilter && (
        <select
          value={projectFilter ?? ""}
          onChange={(e) => onProjectFilter(e.target.value)}
          className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 outline-none focus:border-sky-500/50 shrink-0 max-w-[180px] truncate"
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      )}
      <div className="relative shrink-0">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search…"
          className="pl-8 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 placeholder:text-slate-500 outline-none focus:border-sky-500/50 w-44"
        />
      </div>
    </div>
  );
}
