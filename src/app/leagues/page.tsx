"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiPath } from "@/lib/base-path";
import { Toaster, toast } from "sonner";
import {
  Database,
  ArrowLeft,
  Search,
  Download,
  CheckCircle2,
  RefreshCw,
  Users,
  Calendar,
  Tag,
  X,
} from "lucide-react";

interface LeagueCatalogItem {
  league_id: string;
  league_name: string;
  match_count: number;
  already_added: boolean;
  first_date: string | null;
  last_date: string | null;
  patch_versions: string[];
  teams: string[];
}

type FilterMode = "全部" | "未添加" | "已添加";

export default function LeaguesPage() {
  const router = useRouter();
  const [leagues, setLeagues] = useState<LeagueCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("全部");
  const [patchFilter, setPatchFilter] = useState<string>("全部");
  const [teamKeyword, setTeamKeyword] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const allPatches = useMemo(() => {
    const set = new Set<string>();
    leagues.forEach((l) => l.patch_versions?.forEach((p) => set.add(p)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [leagues]);

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiPath("/api/leagues/catalog"));
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "请求失败");
      }
      const data = await res.json();
      setLeagues(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载联赛列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const teamKw = teamKeyword.trim().toLowerCase();
    return leagues.filter((l) => {
      if (filterMode === "未添加" && l.already_added) return false;
      if (filterMode === "已添加" && !l.already_added) return false;

      if (kw) {
        const hit =
          l.league_name.toLowerCase().includes(kw) ||
          String(l.league_id).includes(kw);
        if (!hit) return false;
      }

      if (patchFilter !== "全部") {
        if (!l.patch_versions?.includes(patchFilter)) return false;
      }

      if (teamKw) {
        const hit = (l.teams ?? []).some((t) => t.toLowerCase().includes(teamKw));
        if (!hit) return false;
      }

      // 时间范围：联赛时间段 [first_date, last_date] 与所选 [dateFrom, dateTo] 有交集
      if (dateFrom && l.last_date && l.last_date < dateFrom) return false;
      if (dateTo && l.first_date && l.first_date > dateTo) return false;

      return true;
    });
  }, [leagues, keyword, filterMode, patchFilter, teamKeyword, dateFrom, dateTo]);

  const matchedTeams = (l: LeagueCatalogItem): string[] => {
    const teamKw = teamKeyword.trim().toLowerCase();
    if (!teamKw) return [];
    return (l.teams ?? []).filter((t) => t.toLowerCase().includes(teamKw));
  };

  const resetFilters = () => {
    setKeyword("");
    setFilterMode("全部");
    setPatchFilter("全部");
    setTeamKeyword("");
    setDateFrom("");
    setDateTo("");
  };

  const selectableFiltered = useMemo(
    () => filtered.filter((l) => !l.already_added),
    [filtered]
  );

  const allSelectableChecked =
    selectableFiltered.length > 0 &&
    selectableFiltered.every((l) => selected.has(l.league_id));

  const toggleOne = (leagueId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(leagueId)) next.delete(leagueId);
      else next.add(leagueId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelectableChecked) {
        selectableFiltered.forEach((l) => next.delete(l.league_id));
      } else {
        selectableFiltered.forEach((l) => next.add(l.league_id));
      }
      return next;
    });
  };

  const handleImport = async () => {
    if (selected.size === 0) {
      toast.error("请先勾选要导入的联赛");
      return;
    }
    setImporting(true);
    try {
      const res = await fetch(apiPath("/api/leagues/import"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ league_ids: Array.from(selected) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "导入失败");
      }
      const data = await res.json();
      const teams = data.imported_teams ?? 0;
      const leaguesCount = data.imported_leagues ?? 0;
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        toast.warning(
          `导入 ${leaguesCount} 个联赛 / ${teams} 支战队，${data.errors.length} 个失败`
        );
      } else {
        toast.success(`成功导入 ${leaguesCount} 个联赛 / ${teams} 支战队`);
      }
      // 汇总缺少补刀数据、无法计算分路的队伍，明确提示缺什么
      const missingTeams = (data.results ?? []).flatMap(
        (r: {
          league_name?: string;
          missing_position_teams?: { team_name: string; players_without_hits: string[] }[];
        }) =>
          (r.missing_position_teams ?? []).map(
            (m) => `${m.team_name}（缺 ${m.players_without_hits.join("、")} 的补刀数据）`
          )
      );
      if (missingTeams.length > 0) {
        toast.warning(
          `${missingTeams.length} 支战队缺少补刀数据、无法计算分路，已标记为「缺失」：` +
            missingTeams.slice(0, 5).join("；") +
            (missingTeams.length > 5 ? " 等" : ""),
          { duration: 10000 }
        );
      }
      setSelected(new Set());
      await fetchCatalog();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <Toaster position="top-right" richColors />
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-600 text-white p-3 rounded-xl shadow-md">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">联赛库</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                从数据库读取所有联赛，勾选后导入到战队阵容管理器
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => router.push("/")} className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              返回管理器
            </Button>
            <Button
              variant="outline"
              onClick={fetchCatalog}
              disabled={loading}
              className="gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              刷新
            </Button>
          </div>
        </div>

        {/* 筛选面板 */}
        <Card className="mb-4">
          <CardContent className="py-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="搜索联赛名或 league_id"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  className="pl-9"
                />
              </div>
              {(["全部", "未添加", "已添加"] as const).map((mode) => (
                <Button
                  key={mode}
                  size="sm"
                  variant={filterMode === mode ? "default" : "outline"}
                  onClick={() => setFilterMode(mode)}
                >
                  {mode}
                </Button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* 按队伍搜索 */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" /> 按队伍筛选
                </Label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    placeholder="搜索队伍，看它参加了哪些比赛"
                    value={teamKeyword}
                    onChange={(e) => setTeamKeyword(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              {/* 版本号 */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500 flex items-center gap-1">
                  <Tag className="w-3.5 h-3.5" /> 版本号
                </Label>
                <Select value={patchFilter} onValueChange={setPatchFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择版本号" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="全部">全部版本</SelectItem>
                    {allPatches.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 时间范围 */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> 时间范围
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                  <span className="text-slate-400 text-sm">至</span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">
                共 {leagues.length} 个联赛，筛选后 {filtered.length} 个
              </span>
              <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1 text-slate-500">
                <X className="w-3.5 h-3.5" /> 清除筛选
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 操作条 */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={allSelectableChecked}
                onCheckedChange={toggleAll}
                disabled={selectableFiltered.length === 0}
              />
              全选当前可添加（{selectableFiltered.length}）
            </label>
            <span className="text-slate-400">已选 {selected.size} 个</span>
          </div>
          <Button onClick={handleImport} disabled={importing || selected.size === 0} className="gap-2">
            <Download className="w-4 h-4" />
            {importing ? "导入中..." : `导入选中（${selected.size}）`}
          </Button>
        </div>

        {/* 列表 */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-slate-500">
              没有匹配的联赛
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((l) => {
              const checked = selected.has(l.league_id);
              return (
                <Card
                  key={l.league_id}
                  className={`transition-colors ${
                    l.already_added
                      ? "bg-slate-50 border-slate-200"
                      : checked
                      ? "border-emerald-400 bg-emerald-50/40"
                      : "hover:border-slate-300"
                  }`}
                >
                  <CardContent className="py-3 px-4 flex items-center gap-3">
                    <Checkbox
                      checked={checked}
                      disabled={l.already_added}
                      onCheckedChange={() => toggleOne(l.league_id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-900 truncate">
                        {l.league_name}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>league_id: {l.league_id}</span>
                        <span>{l.match_count} 场</span>
                        {(l.first_date || l.last_date) && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {l.first_date ?? "?"} ~ {l.last_date ?? "?"}
                          </span>
                        )}
                        {l.patch_versions?.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Tag className="w-3 h-3" />
                            {l.patch_versions.join(" / ")}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {l.teams?.length ?? 0} 支队伍
                        </span>
                      </div>
                      {matchedTeams(l).length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {matchedTeams(l).slice(0, 8).map((t) => (
                            <Badge
                              key={t}
                              variant="outline"
                              className="text-[10px] py-0 border-emerald-300 text-emerald-700"
                            >
                              {t}
                            </Badge>
                          ))}
                          {matchedTeams(l).length > 8 && (
                            <span className="text-[10px] text-slate-400">
                              +{matchedTeams(l).length - 8}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {l.already_added ? (
                      <Badge className="bg-emerald-600 text-white gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        已添加
                      </Badge>
                    ) : (
                      <Badge variant="secondary">未添加</Badge>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
