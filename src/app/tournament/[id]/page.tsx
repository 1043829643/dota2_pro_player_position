"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
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
import { Toaster, toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Users,
  ChevronRight,
  Shield,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

interface Player {
  id: number;
  team_id: number;
  nickname: string;
  steamid64: string | null;
  position: number;
}

interface Team {
  id: number;
  tournament_id: number;
  name: string;
  short_name: string | null;
  team_id: string | null;
  status: string;
  summary: string;
  players: Player[];
}

const statusConfig: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  "完整": { label: "完整", icon: CheckCircle2, color: "text-green-600 bg-green-50 border-green-200" },
  "缺失": { label: "缺失", icon: AlertTriangle, color: "text-amber-600 bg-amber-50 border-amber-200" },
  "重复": { label: "重复", icon: XCircle, color: "text-red-600 bg-red-50 border-red-200" },
  "待确认": { label: "待确认", icon: HelpCircle, color: "text-blue-600 bg-blue-50 border-blue-200" },
};

export default function TournamentPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = params.id as string;
  const [tournamentName, setTournamentName] = useState("");
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [openCreateTeam, setOpenCreateTeam] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamShortName, setTeamShortName] = useState("");
  const [teamExternalId, setTeamExternalId] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchTeams = useCallback(async () => {
    try {
      const [teamsRes, tourRes] = await Promise.all([
        fetch(`/api/tournaments/${tournamentId}/teams`),
        fetch(`/api/tournaments/${tournamentId}`),
      ]);
      const teamsData = await teamsRes.json();
      const tourData = await tourRes.json();
      setTeams(teamsData);
      setTournamentName(tourData.name || "");
    } catch {
      toast.error("加载战队列表失败");
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const handleCreateTeam = async () => {
    if (!teamName.trim()) {
      toast.error("请填写战队名");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/teams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: teamName.trim(),
          short_name: teamShortName.trim() || null,
          team_id: teamExternalId.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("创建失败");
      toast.success("战队已添加");
      setOpenCreateTeam(false);
      setTeamName("");
      setTeamShortName("");
      setTeamExternalId("");
      await fetchTeams();
    } catch {
      toast.error("创建战队失败");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteTeam = async (id: number) => {
    if (!confirm("确认删除该战队及所有选手数据？")) return;
    try {
      const res = await fetch(`/api/teams/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      toast.success("战队已删除");
      await fetchTeams();
    } catch {
      toast.error("删除失败");
    }
  };

  const renderStatusBadge = (status: string) => {
    const config = statusConfig[status] || statusConfig["缺失"];
    const Icon = config.icon;
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${config.color}`}>
        <Icon className="w-3.5 h-3.5" />
        {config.label}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <Toaster position="top-right" richColors />
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* 导航 */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" onClick={() => router.push("/")} className="gap-1">
            <ArrowLeft className="w-4 h-4" />
            比赛列表
          </Button>
          <span className="text-slate-300">/</span>
          <span className="text-sm font-medium text-slate-600">{tournamentName || "加载中..."}</span>
        </div>

        {/* 头部 */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 text-white p-3 rounded-xl shadow-md">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{tournamentName || "比赛详情"}</h1>
              <p className="text-sm text-slate-500 mt-0.5">{teams.length} 支战队</p>
            </div>
          </div>
          <Button onClick={() => setOpenCreateTeam(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            添加战队
          </Button>
        </div>

        {/* 战队列表 */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-48 rounded-xl" />
            ))}
          </div>
        ) : teams.length === 0 ? (
          <div className="text-center py-24">
            <Users className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-600 mb-2">还没有战队</h2>
            <p className="text-slate-400 mb-6">点击上方「添加战队」开始管理阵容</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {teams.map((team) => (
              <Card
                key={team.id}
                className="cursor-pointer hover:shadow-lg transition-all duration-200 border border-slate-200 hover:border-indigo-300 group"
                onClick={() => router.push(`/team/${team.id}`)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                        <span className="text-indigo-700 font-bold text-sm">
                          {team.short_name || team.name.charAt(0)}
                        </span>
                      </div>
                      <div>
                        <CardTitle className="text-lg text-slate-800">{team.name}</CardTitle>
                        {team.short_name && (
                          <p className="text-xs text-slate-400">{team.short_name}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {renderStatusBadge(team.status)}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTeam(team.id);
                        }}
                        className="text-slate-300 hover:text-red-500 transition-colors text-sm opacity-0 group-hover:opacity-100"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {team.team_id && (
                    <p className="text-xs text-slate-400 mb-2">Team ID: {team.team_id}</p>
                  )}
                  <div className="bg-slate-50 rounded-lg p-3">
                    {team.summary ? (
                      <div className="space-y-1">
                        {team.players.map((p) => (
                          <div key={p.id} className="flex items-center justify-between text-sm">
                            <span className="text-slate-700">{p.nickname}</span>
                            <span className="text-xs text-slate-400">{p.position}号位</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-400 text-center py-2">暂无选手</p>
                    )}
                  </div>
                  <div className="flex items-center justify-end mt-3">
                    <span className="text-xs text-indigo-500 group-hover:underline flex items-center gap-1">
                      编辑阵容 <ChevronRight className="w-3 h-3" />
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 添加战队弹窗 */}
      <Dialog open={openCreateTeam} onOpenChange={setOpenCreateTeam}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加战队</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="team_name">战队名 *</Label>
              <Input
                id="team_name"
                placeholder="例如：Team Liquid"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team_short">简称</Label>
              <Input
                id="team_short"
                placeholder="例如：TL"
                value={teamShortName}
                onChange={(e) => setTeamShortName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team_ext_id">Team ID</Label>
              <Input
                id="team_ext_id"
                placeholder="外部战队标识"
                value={teamExternalId}
                onChange={(e) => setTeamExternalId(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreateTeam(false)}>
              取消
            </Button>
            <Button onClick={handleCreateTeam} disabled={creating}>
              {creating ? "添加中..." : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}