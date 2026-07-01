"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  Trophy,
  Plus,
  ChevronRight,
  Users,
  Calendar,
  Hash,
  UserCog,
  Download,
  Database,
  Fingerprint,
} from "lucide-react";

interface Tournament {
  id: number;
  name: string;
  league_id: string;
  event_tier: "顶级赛事" | "预选赛" | "其他";
  teams_count: number;
  completion: string;
  updated_at: string;
}

export default function HomePage() {
  const router = useRouter();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLeagueId, setNewLeagueId] = useState("");
  const [creating, setCreating] = useState(false);
  const [tierFilter, setTierFilter] = useState<"全部" | "顶级赛事" | "预选赛">("全部");
  const [openExport, setOpenExport] = useState(false);
  const [exportTier, setExportTier] = useState<"all" | "top" | "qualifier">("all");
  const [exportFormat, setExportFormat] = useState<"full" | "ids">("full");
  const [exporting, setExporting] = useState(false);

  const fetchTournaments = useCallback(async () => {
    try {
      const res = await fetch(apiPath("/api/tournaments"));
      if (!res.ok) throw new Error("请求失败");
      const data = await res.json();
      setTournaments(Array.isArray(data) ? data : []);
    } catch {
      toast.error("加载比赛列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTournaments();
  }, [fetchTournaments]);

  const handleCreate = async () => {
    if (!newName.trim() || !newLeagueId.trim()) {
      toast.error("请填写比赛名和联赛标识");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(apiPath("/api/tournaments"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), league_id: newLeagueId.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }
      toast.success("比赛已创建");
      setOpen(false);
      setNewName("");
      setNewLeagueId("");
      await fetchTournaments();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确认删除该比赛及所有相关数据？")) return;
    try {
      const res = await fetch(apiPath(`/api/tournaments/${id}`), { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      toast.success("比赛已删除");
      await fetchTournaments();
    } catch {
      toast.error("删除失败");
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const getCompletionBadge = (completion: string) => {
    const [filled, total] = completion.split("/").map(Number);
    if (total === 0) return <Badge variant="secondary">空</Badge>;
    const ratio = filled / total;
    if (ratio >= 1) return <Badge className="bg-green-500 text-white">已完成</Badge>;
    if (ratio >= 0.5) return <Badge className="bg-amber-500 text-white">进行中</Badge>;
    return <Badge variant="destructive">待填充</Badge>;
  };

  const getTierBadge = (tier: Tournament["event_tier"]) => {
    if (tier === "顶级赛事") {
      return <Badge className="bg-purple-600 text-white">顶级赛事</Badge>;
    }
    if (tier === "预选赛") {
      return <Badge className="bg-blue-600 text-white">预选赛</Badge>;
    }
    return <Badge variant="secondary">其他</Badge>;
  };

  const filteredTournaments = tournaments.filter((t) => {
    if (tierFilter === "全部") return true;
    return t.event_tier === tierFilter;
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({
        scope: "all",
        tier: exportTier,
        format: exportFormat,
      });
      const res = await fetch(apiPath(`/api/export?${params.toString()}`));
      if (!res.ok) throw new Error("导出失败");
      const blob = await res.blob();
      const tierName =
        exportTier === "top" ? "top" : exportTier === "qualifier" ? "qualifier" : "all";
      const formatName = exportFormat === "ids" ? "ids" : "full";
      const fileName = `lineup-export-${tierName}-${formatName}-${Date.now()}.csv`;

      type SavePickerWindow = Window & {
        showSaveFilePicker?: (options: {
          suggestedName?: string;
          types?: Array<{ description?: string; accept: Record<string, string[]> }>;
        }) => Promise<{
          createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
        }>;
      };

      const pickerWindow = window as SavePickerWindow;
      if (pickerWindow.showSaveFilePicker) {
        const handle = await pickerWindow.showSaveFilePicker({
          suggestedName: fileName,
          types: [
            {
              description: "CSV 文件",
              accept: { "text/csv": [".csv"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }

      toast.success("导出成功");
      setOpenExport(false);
    } catch (e) {
      const err = e as Error;
      if (err?.name === "AbortError") {
        toast.message("已取消导出");
      } else {
        toast.error("导出失败");
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <Toaster position="top-right" richColors />
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 text-white p-3 rounded-xl shadow-md">
              <Trophy className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">战队阵容管理器</h1>
              <p className="text-sm text-slate-500 mt-0.5">管理比赛、战队与 1~5 号位选手阵容</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => router.push("/leagues")} className="gap-2">
              <Database className="w-4 h-4" />
              联赛库
            </Button>
            <Button variant="outline" onClick={() => router.push("/players")} className="gap-2">
              <UserCog className="w-4 h-4" />
              选手管理
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/team-id")}
              className="gap-2"
            >
              <Fingerprint className="w-4 h-4" />
              队伍ID工具
            </Button>
            <Button variant="outline" onClick={() => setOpenExport(true)} className="gap-2">
              <Download className="w-4 h-4" />
              导出
            </Button>
            <Button onClick={() => setOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              新建比赛
            </Button>
          </div>
        </div>

        {/* 比赛列表 */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-slate-500">筛选：</span>
          {(["全部", "顶级赛事", "预选赛"] as const).map((tier) => (
            <Button
              key={tier}
              variant={tierFilter === tier ? "default" : "outline"}
              size="sm"
              onClick={() => setTierFilter(tier)}
            >
              {tier}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : filteredTournaments.length === 0 ? (
          <div className="text-center py-24">
            <Trophy className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-600 mb-2">当前筛选无比赛</h2>
            <p className="text-slate-400 mb-6">切换筛选项或新建比赛</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTournaments.map((t) => (
              <Card
                key={t.id}
                className="cursor-pointer hover:shadow-lg transition-all duration-200 border border-slate-200 hover:border-indigo-300 group"
                onClick={() => router.push(`/tournament/${t.id}`)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <CardTitle className="text-lg text-slate-800 group-hover:text-indigo-600 transition-colors">
                        {t.name}
                      </CardTitle>
                      {getTierBadge(t.event_tier)}
                    </div>
                    <button
                      onClick={(e) => handleDelete(t.id, e)}
                      className="text-slate-300 hover:text-red-500 transition-colors text-sm opacity-0 group-hover:opacity-100"
                    >
                      删除
                    </button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-slate-500">
                      <Hash className="w-4 h-4" />
                      <span>{t.league_id}</span>
                    </div>
                    <div className="flex items-center gap-2 text-slate-500">
                      <Users className="w-4 h-4" />
                      <span>{t.teams_count} 支战队</span>
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">阵容：</span>
                        {getCompletionBadge(t.completion)}
                        <span className="text-xs text-slate-400 ml-1">{t.completion}</span>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-400 transition-colors" />
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-400 pt-1">
                      <Calendar className="w-3 h-3" />
                      <span>{formatDate(t.updated_at)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 新建比赛弹窗 */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建比赛</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="name">比赛名</Label>
              <Input
                id="name"
                placeholder="例如：TI13 国际邀请赛"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="league_id">联赛标识 (League ID)</Label>
              <Input
                id="league_id"
                placeholder="例如：ti13-2024"
                value={newLeagueId}
                onChange={(e) => setNewLeagueId(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 导出弹窗 */}
      <Dialog open={openExport} onOpenChange={setOpenExport}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>导出阵容数据</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>导出范围</Label>
              <Select
                value={exportTier}
                onValueChange={(v: "all" | "top" | "qualifier") => setExportTier(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择导出范围" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部赛事</SelectItem>
                  <SelectItem value="top">仅顶级赛事</SelectItem>
                  <SelectItem value="qualifier">仅预选赛</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>导出字段</Label>
              <Select
                value={exportFormat}
                onValueChange={(v: "full" | "ids") => setExportFormat(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择导出字段" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">完整信息（含战队、昵称、链接）</SelectItem>
                  <SelectItem value="ids">仅 联赛id + steamid + 位置</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-slate-500">
              导出时将优先弹出本地保存位置选择器；若浏览器不支持则自动下载到默认下载目录。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenExport(false)}>
              取消
            </Button>
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? "导出中..." : "开始导出"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}