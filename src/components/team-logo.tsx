"use client";

import { useEffect, useState } from "react";
import { apiPath } from "@/lib/base-path";

export interface TeamLogoInfo {
  team_id: string;
  name: string;
  tag: string;
  logo_url: string;
}

const logoCache = new Map<string, TeamLogoInfo>();

function isRealTeamId(id?: string | null): id is string {
  return !!id && /^\d+$/.test(id) && id !== "0";
}

/** 批量预加载队徽（列表页用，减少重复请求） */
export function useTeamLogos(teamIds: (string | null | undefined)[]) {
  const [logos, setLogos] = useState<Record<string, TeamLogoInfo>>({});

  useEffect(() => {
    const ids = Array.from(new Set(teamIds.filter(isRealTeamId)));
    if (ids.length === 0) return;

    const cached: Record<string, TeamLogoInfo> = {};
    const need: string[] = [];
    for (const id of ids) {
      const hit = logoCache.get(id);
      if (hit) cached[id] = hit;
      else need.push(id);
    }
    if (Object.keys(cached).length > 0) {
      setLogos((prev) => ({ ...prev, ...cached }));
    }
    if (need.length === 0) return;

    fetch(apiPath(`/api/team-id/team-logo?ids=${need.join(",")}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.logos) return;
        for (const [id, info] of Object.entries(data.logos as Record<string, TeamLogoInfo>)) {
          logoCache.set(id, info);
        }
        setLogos((prev) => ({ ...prev, ...data.logos }));
      })
      .catch(() => {});
  }, [teamIds.join(",")]);

  return logos;
}

interface TeamLogoProps {
  teamId?: string | null;
  name: string;
  shortName?: string | null;
  size?: number;
  className?: string;
  logoInfo?: TeamLogoInfo;
  rounded?: "full" | "lg" | "md";
}

export function TeamLogo({
  teamId,
  name,
  shortName,
  size = 40,
  className = "",
  logoInfo,
  rounded = "full",
}: TeamLogoProps) {
  const [info, setInfo] = useState<TeamLogoInfo | undefined>(logoInfo);

  useEffect(() => {
    if (logoInfo) {
      setInfo(logoInfo);
      return;
    }
    if (!isRealTeamId(teamId)) return;

    const cached = logoCache.get(teamId);
    if (cached) {
      setInfo(cached);
      return;
    }

    fetch(apiPath(`/api/team-id/team-logo?team_id=${teamId}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.logo_url === "string") {
          logoCache.set(teamId, data);
          setInfo(data);
        }
      })
      .catch(() => {});
  }, [teamId, logoInfo]);

  const letter = (shortName || name).charAt(0).toUpperCase();
  const radius =
    rounded === "full" ? "rounded-full" : rounded === "lg" ? "rounded-lg" : "rounded-md";
  const style = { width: size, height: size };

  if (info?.logo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={info.logo_url}
        alt={info.name || name}
        title={info.name || name}
        className={`${radius} object-contain bg-white border border-slate-200 shrink-0 ${className}`}
        style={style}
      />
    );
  }

  return (
    <div
      className={`${radius} bg-indigo-100 flex items-center justify-center shrink-0 ${className}`}
      style={style}
      title={name}
    >
      <span className="text-indigo-700 font-bold" style={{ fontSize: Math.max(10, size * 0.35) }}>
        {letter}
      </span>
    </div>
  );
}
