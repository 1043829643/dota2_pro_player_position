"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster, toast } from "sonner";
import {
  Fingerprint,
  ArrowLeft,
  Search,
  Users,
  Trophy,
  ScanSearch,
  Table2,
  Plus,
  Trash2,
  Save,
  RefreshCw,
  ListPlus,
} from "lucide-react";

interface AnomalyRow {
  league_id: string;
  league_name: string;
  roster_key: string;
  roster_players: string;
  league_count: number;
  team_id_count: number;
  roster_occurrences: number;
  team_ids: string;
  team_id_names: string;
  match_ids: string;
  first_seen: number | string;
  last_seen: number | string;
}

interface TeamInfo {
  team_id: string;
  name: string;
  tag: string;
  logo_url: string;
}

interface PlayerCandidate {
  steamid: string;
  name: string;
}

interface ManualRecord {
  group_id: string;
  roster: string;
  league_id: string;
  league_name: string;
  team_id: string;
  team_name: string;
  team_logo: string;
  note: string;
}

interface TrackResult {
  steamid: string;
  player_name: string;
  total_matches: number;
  team_count: number;
  league_count: number;
  teams: Array<{
    team_id: string;
    team_name: string;
    match_count: number;
    leagues: Array<{ league_id: string; league_name: string; match_count: number }>;
  }>;
  leagues: Array<{
    league_id: string;
    league_name: string;
    match_count: number;
    teams: Array<{ team_id: string; team_name: string; match_count: number }>;
  }>;
}

function fmtDate(ts: number | string): string {
  const n = Number(ts);
  if (!ts || Number.isNaN(n) || n <= 0) return "-";
  const d = new Date(n * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parsePieces(raw: string): Array<{ id: string; label: string }> {
  return raw
    .split(";;")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const idx = p.indexOf(" | ");
      if (idx >= 0) return { id: p.slice(0, idx).trim(), label: p.slice(idx + 3).trim() };
      return { id: p, label: "" };
    });
}

function TeamLogo({ info }: { info?: TeamInfo }) {
  if (info?.logo_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={info.logo_url} alt={info.name} className="w-5 h-5 rounded object-contain inline-block align-middle" />;
  }
  return <span className="inline-block w-5 h-5 rounded bg-slate-200 align-middle" />;
}

export default function TeamIdPage() {
  const router = useRouter();

  // 检测
  const [mode, setMode] = useState<"same_league" | "cross_league">("same_league");
  const [maxDiff, setMaxDiff] = useState<"0" | "1" | "2">("0");
  const [leagueId, setLeagueId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [limit, setLimit] = useState("100");
  const [detecting, setDetecting] = useState(false);
  const [rows, setRows] = useState<AnomalyRow[]>([]);
  const [logos, setLogos] = useState<Record<string, TeamInfo>>({});

  // 选手追踪
  const [trackInput, setTrackInput] = useState("");
  const [candidates, setCandidates] = useState<PlayerCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [track, setTrack] = useState<TrackResult | null>(null);

  // 维护表
  const [tab, setTab] = useState("detect");
  const [records, setRecords] = useState<ManualRecord[]>([]);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsDirty, setRecordsDirty] = useState(false);
  const [savingRecords, setSavingRecords] = useState(false);

  const loadLogos = useCallback(
    async (teamIds: string[]) => {
      const need = Array.from(new Set(teamIds)).filter((id) => id && !logos[id]);
      if (need.length === 0) return;
      try {
        const res = await fetch(`/api/team-id/team-logo?ids=${need.join(",")}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.logos) setLogos((prev) => ({ ...prev, ...data.logos }));
      } catch {
        /* 队徽失败不影响主流程 */
      }
    },
    [logos]
  );

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const res = await fetch("/api/team-id/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          detection_mode: mode,
          max_diff: Number(maxDiff),
          league_id: leagueId.trim() || undefined,
          start_time: dateFrom || undefined,
          end_time: dateTo || undefined,
          limit: limit.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "检测失败");
      }
      const data = await res.json();
      const result: AnomalyRow[] = data.rows ?? [];
      setRows(result);
      toast.success(`检测到 ${result.length} 组异常`);
      const allTeamIds = result.flatMap((r) => r.team_ids.split(",").filter(Boolean));
      loadLogos(allTeamIds);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "检测失败");
    } finally {
      setDetecting(false);
    }
  };

  const handleSearchName = async () => {
    const q = trackInput.trim();
    if (!q) return;
    setSearching(true);
    setCandidates([]);
    try {
      const res = await fetch(`/api/team-id/player-candidates?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error("搜索失败");
      const data = await res.json();
      setCandidates(data.candidates ?? []);
      if ((data.candidates ?? []).length === 0) toast.message("没有匹配的选手");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "搜索失败");
    } finally {
      setSearching(false);
    }
  };

  const doTrack = async (steamid: string) => {
    setTracking(true);
    setTrack(null);
    try {
      const res = await fetch("/api/team-id/player-track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steamid }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "追踪失败");
      }
      const data: TrackResult = await res.json();
      setTrack(data);
      setCandidates([]);
      loadLogos(data.teams.map((t) => t.team_id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "追踪失败");
    } finally {
      setTracking(false);
    }
  };

  const handleTrack = async () => {
    const v = trackInput.trim();
    if (/^\d+$/.test(v)) {
      await doTrack(v);
    } else {
      await handleSearchName();
    }
  };

  // ===== 维护表 =====
  const loadRecords = useCallback(async () => {
    setRecordsLoading(true);
    try {
      const res = await fetch("/api/team-id/manual-records");
      if (!res.ok) throw new Error("读取维护表失败");
      const data = await res.json();
      setRecords(data.records ?? []);
      setRecordsLoaded(true);
      setRecordsDirty(false);
      loadLogos((data.records ?? []).map((r: ManualRecord) => r.team_id).filter(Boolean));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "读取维护表失败");
    } finally {
      setRecordsLoading(false);
    }
  }, [loadLogos]);

  const handleTabChange = (v: string) => {
    setTab(v);
    if (v === "manual" && !recordsLoaded && !recordsLoading) {
      loadRecords();
    }
  };

  const saveRecords = async () => {
    setSavingRecords(true);
    try {
      const res = await fetch("/api/team-id/manual-records/save-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "保存失败");
      }
      const data = await res.json();
      setRecords(data.records ?? []);
      setRecordsDirty(false);
      toast.success(`已保存 ${data.records?.length ?? 0} 条记录`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingRecords(false);
    }
  };

  const updateRecord = (index: number, field: keyof ManualRecord, value: string) => {
    setRecords((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
    setRecordsDirty(true);
  };

  const nextGroupId = () => {
    const ids = records.map((r) => Number(r.group_id)).filter((n) => !Number.isNaN(n));
    return ids.length ? String(Math.max(...ids) + 1) : "1";
  };

  const addRecord = (template?: Partial<ManualRecord>) => {
    const blank: ManualRecord = {
      group_id: template?.group_id ?? nextGroupId(),
      roster: template?.roster ?? "",
      league_id: template?.league_id ?? "",
      league_name: template?.league_name ?? "",
      team_id: template?.team_id ?? "",
      team_name: template?.team_name ?? "",
      team_logo: template?.team_logo ?? "",
      note: template?.note ?? "",
    };
    setRecords((prev) => [...prev, blank]);
    setRecordsDirty(true);
  };

  const removeRecord = (index: number) => {
    setRecords((prev) => prev.filter((_, i) => i !== index));
    setRecordsDirty(true);
  };

  // 从检测结果一键加入维护表
  const addAnomalyToManual = (r: AnomalyRow) => {
    const gid = nextGroupId();
    const teamPieces = parsePieces(r.team_id_names);
    const players = parsePieces(r.roster_players);
    const leagues = parsePieces(r.league_name);
    const rosterStr = players.map((p) => p.label || p.id).join("、");
    const leagueId = r.league_id?.split(",")[0]?.trim() || leagues[0]?.id || "";
    const leagueName = leagues[0]?.label || leagues[0]?.id || "";
    const newRows: ManualRecord[] = teamPieces.map((t) => ({
      group_id: gid,
      roster: rosterStr,
      league_id: leagueId,
      league_name: leagueName,
      team_id: t.id,
      team_name: t.label,
      team_logo: logos[t.id]?.logo_url ?? "",
      note: "",
    }));
    if (newRows.length === 0) {
      toast.message("该异常没有可加入的 team_id");
      return;
    }
    setRecords((prev) => {
      if (recordsLoaded) return [...prev, ...newRows];
      return newRows;
    });
    setRecordsLoaded(true);
    setRecordsDirty(true);
    setTab("manual");
    toast.success(`已加入维护表（组 ${gid}，${newRows.length} 个 team_id），记得点击保存`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <Toaster position="top-right" richColors />
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-rose-600 text-white p-3 rounded-xl shadow-md">
              <Fingerprint className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">队伍ID工具</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                同阵容多 team_id 检测 · 选手追踪 · 战队队徽
              </p>
            </div>
          </div>
          <Button variant="outline" onClick={() => router.push("/")} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            返回管理器
          </Button>
        </div>

        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="detect" className="gap-1">
              <ScanSearch className="w-4 h-4" /> 同阵容检测
            </TabsTrigger>
            <TabsTrigger value="track" className="gap-1">
              <Users className="w-4 h-4" /> 选手追踪
            </TabsTrigger>
            <TabsTrigger value="manual" className="gap-1">
              <Table2 className="w-4 h-4" /> 维护表
            </TabsTrigger>
          </TabsList>

          {/* ===== 同阵容检测 ===== */}
          <TabsContent value="detect" className="mt-4 space-y-4">
            <Card>
              <CardContent className="py-4 grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">检测模式</Label>
                  <Select value={mode} onValueChange={(v: "same_league" | "cross_league") => setMode(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="same_league">同联赛内</SelectItem>
                      <SelectItem value="cross_league">跨联赛</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">阵容差异容忍</Label>
                  <Select value={maxDiff} onValueChange={(v: "0" | "1" | "2") => setMaxDiff(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">完全相同</SelectItem>
                      <SelectItem value="1">允许 1 人不同</SelectItem>
                      <SelectItem value="2">允许 2 人不同</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">league_id（可选）</Label>
                  <Input value={leagueId} onChange={(e) => setLeagueId(e.target.value)} placeholder="不填=全部" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">起始日期</Label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">结束日期</Label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">数量上限</Label>
                  <div className="flex gap-2">
                    <Input value={limit} onChange={(e) => setLimit(e.target.value)} className="w-20" />
                    <Button onClick={handleDetect} disabled={detecting} className="flex-1 gap-1">
                      <ScanSearch className="w-4 h-4" />
                      {detecting ? "检测中..." : "检测"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {rows.length > 0 && (() => {
              const distinctTeamIds = new Set(
                rows.flatMap((r) => r.team_ids.split(",").map((s) => s.trim()).filter(Boolean))
              );
              const distinctLeagues = new Set(
                rows.flatMap((r) =>
                  String(r.league_id).split(",").map((s) => s.trim()).filter(Boolean)
                )
              );
              const totalMatches = rows.reduce(
                (acc, r) => acc + (r.match_ids ? r.match_ids.split(",").filter(Boolean).length : 0),
                0
              );
              const stats = [
                { label: "异常组", value: rows.length },
                { label: "涉及 team_id", value: distinctTeamIds.size },
                { label: "涉及联赛", value: distinctLeagues.size },
                { label: "涉及比赛", value: totalMatches },
              ];
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {stats.map((s) => (
                    <Card key={s.label}>
                      <CardContent className="py-3 text-center">
                        <div className="text-2xl font-bold text-rose-600">{s.value}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              );
            })()}

            <div className="space-y-3">
              {rows.map((r, i) => {
                const teamPieces = parsePieces(r.team_id_names);
                const players = parsePieces(r.roster_players);
                const leagues = parsePieces(r.league_name);
                const matchCount = r.match_ids ? r.match_ids.split(",").filter(Boolean).length : 0;
                return (
                  <Card key={i}>
                    <CardContent className="py-3 px-4 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="bg-rose-600 text-white">{r.team_id_count} 个 team_id</Badge>
                        <Badge variant="secondary">{r.roster_occurrences} 次出场</Badge>
                        <Badge variant="outline">{matchCount} 场比赛</Badge>
                        {mode === "cross_league" ? (
                          <Badge variant="outline">{r.league_count} 个联赛</Badge>
                        ) : (
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            <Trophy className="w-3 h-3" />
                            {leagues[0]?.label || r.league_name || r.league_id}
                          </span>
                        )}
                        <span className="text-xs text-slate-400 ml-auto">
                          {fmtDate(r.first_seen)} ~ {fmtDate(r.last_seen)}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs"
                          onClick={() => addAnomalyToManual(r)}
                        >
                          <ListPlus className="w-3.5 h-3.5" /> 加入维护表
                        </Button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {teamPieces.map((t) => (
                          <span
                            key={t.id}
                            className="inline-flex items-center gap-1.5 bg-slate-100 rounded-md px-2 py-1 text-xs"
                          >
                            <TeamLogo info={logos[t.id]} />
                            <span className="font-medium">{t.label || "(无名)"}</span>
                            <span className="text-slate-400">#{t.id}</span>
                          </span>
                        ))}
                      </div>

                      <div className="text-xs text-slate-500">
                        阵容：{players.map((p) => p.label || p.id).join("、")}
                      </div>
                      {mode === "cross_league" && leagues.length > 0 && (
                        <div className="text-xs text-slate-400">
                          联赛：{leagues.map((l) => l.label || l.id).join("、")}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* ===== 选手追踪 ===== */}
          <TabsContent value="track" className="mt-4 space-y-4">
            <Card>
              <CardContent className="py-4">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input
                      className="pl-9"
                      placeholder="输入 steamid（纯数字直接追踪）或选手名（搜索后选择）"
                      value={trackInput}
                      onChange={(e) => setTrackInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleTrack()}
                    />
                  </div>
                  <Button onClick={handleTrack} disabled={tracking || searching} className="gap-1">
                    <Search className="w-4 h-4" />
                    {tracking || searching ? "处理中..." : "追踪"}
                  </Button>
                </div>

                {candidates.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {candidates.map((c) => (
                      <Button
                        key={c.steamid}
                        size="sm"
                        variant="outline"
                        onClick={() => doTrack(c.steamid)}
                      >
                        {c.name} <span className="text-slate-400 ml-1">#{c.steamid}</span>
                      </Button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {track && (
              <>
                <Card>
                  <CardContent className="py-4 flex flex-wrap items-center gap-4">
                    <div>
                      <div className="text-lg font-bold text-slate-900">{track.player_name || "(未知选手)"}</div>
                      <div className="text-xs text-slate-400">#{track.steamid}</div>
                    </div>
                    <Badge variant="secondary">{track.total_matches} 场</Badge>
                    <Badge variant="secondary">{track.team_count} 支队伍</Badge>
                    <Badge variant="secondary">{track.league_count} 个联赛</Badge>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardContent className="py-4">
                      <div className="font-medium text-slate-800 mb-2 flex items-center gap-1">
                        <Users className="w-4 h-4" /> 代表过的队伍
                      </div>
                      <div className="space-y-2">
                        {track.teams.map((t) => (
                          <div key={t.team_id} className="border rounded-md p-2">
                            <div className="flex items-center gap-2">
                              <TeamLogo info={logos[t.team_id]} />
                              <span className="font-medium text-sm">{t.team_name || "(无名)"}</span>
                              <span className="text-xs text-slate-400">#{t.team_id}</span>
                              <Badge variant="outline" className="ml-auto">{t.match_count} 场</Badge>
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              {t.leagues.map((l) => `${l.league_name || l.league_id}(${l.match_count})`).join("、")}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="py-4">
                      <div className="font-medium text-slate-800 mb-2 flex items-center gap-1">
                        <Trophy className="w-4 h-4" /> 参加过的联赛
                      </div>
                      <div className="space-y-2">
                        {track.leagues.map((l) => (
                          <div key={l.league_id} className="border rounded-md p-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm">{l.league_name || l.league_id}</span>
                              <span className="text-xs text-slate-400">#{l.league_id}</span>
                              <Badge variant="outline" className="ml-auto">{l.match_count} 场</Badge>
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              {l.teams.map((t) => `${t.team_name || t.team_id}(${t.match_count})`).join("、")}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </TabsContent>

          {/* ===== 维护表 ===== */}
          <TabsContent value="manual" className="mt-4 space-y-4">
            <Card>
              <CardContent className="py-4 flex flex-wrap items-center gap-3">
                <div className="text-sm text-slate-600">
                  同一支真实队伍的多个 team_id 映射表（共 {records.length} 条）
                  {recordsDirty && <span className="text-amber-600 ml-2">· 有未保存改动</span>}
                </div>
                <div className="ml-auto flex gap-2">
                  <Button variant="outline" size="sm" className="gap-1" onClick={loadRecords} disabled={recordsLoading}>
                    <RefreshCw className={`w-4 h-4 ${recordsLoading ? "animate-spin" : ""}`} /> 刷新
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => addRecord()}>
                    <Plus className="w-4 h-4" /> 新增一行
                  </Button>
                  <Button size="sm" className="gap-1" onClick={saveRecords} disabled={savingRecords || !recordsDirty}>
                    <Save className="w-4 h-4" /> {savingRecords ? "保存中..." : "保存"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {recordsLoading && records.length === 0 ? (
              <div className="text-sm text-slate-400 py-8 text-center">加载中...</div>
            ) : records.length === 0 ? (
              <div className="text-sm text-slate-400 py-8 text-center">
                暂无记录。可在「同阵容检测」结果中点击「加入维护表」，或点击上方「新增一行」。
              </div>
            ) : (
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 text-slate-500">
                      <tr>
                        <th className="px-2 py-2 text-left w-12">组</th>
                        <th className="px-2 py-2 text-left min-w-[160px]">阵容</th>
                        <th className="px-2 py-2 text-left w-20">联赛ID</th>
                        <th className="px-2 py-2 text-left min-w-[140px]">联赛名</th>
                        <th className="px-2 py-2 text-left w-8">徽</th>
                        <th className="px-2 py-2 text-left w-24">team_id</th>
                        <th className="px-2 py-2 text-left min-w-[100px]">队名</th>
                        <th className="px-2 py-2 text-left min-w-[100px]">备注</th>
                        <th className="px-2 py-2 text-left w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r, i) => {
                        const gid = r.group_id || "";
                        const gNum = Number(gid);
                        const stripe = !Number.isNaN(gNum)
                          ? gNum % 2 === 0
                            ? "bg-sky-50/60"
                            : "bg-white"
                          : "bg-white";
                        const logoUrl = r.team_logo || logos[r.team_id]?.logo_url || "";
                        const cell = (field: keyof ManualRecord, w = "") => (
                          <Input
                            value={r[field]}
                            onChange={(e) => updateRecord(i, field, e.target.value)}
                            className={`h-7 text-xs px-1.5 ${w}`}
                          />
                        );
                        return (
                          <tr key={i} className={`${stripe} border-t border-slate-100`}>
                            <td className="px-2 py-1">{cell("group_id")}</td>
                            <td className="px-2 py-1">{cell("roster")}</td>
                            <td className="px-2 py-1">{cell("league_id")}</td>
                            <td className="px-2 py-1">{cell("league_name")}</td>
                            <td className="px-2 py-1 text-center">
                              {logoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={logoUrl} alt="" className="w-5 h-5 rounded object-contain inline-block" />
                              ) : (
                                <span className="inline-block w-5 h-5 rounded bg-slate-200" />
                              )}
                            </td>
                            <td className="px-2 py-1">{cell("team_id")}</td>
                            <td className="px-2 py-1">{cell("team_name")}</td>
                            <td className="px-2 py-1">{cell("note")}</td>
                            <td className="px-2 py-1 text-center">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-rose-500 hover:text-rose-600"
                                onClick={() => removeRecord(i)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
