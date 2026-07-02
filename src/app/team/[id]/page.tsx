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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { apiPath } from "@/lib/base-path";
import { TeamLogo } from "@/components/team-logo";
import { Toaster, toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Save,
  CheckCircle2,
  Users,
  AlertTriangle,
  Flag,
} from "lucide-react";

interface Player {
  id: number;
  team_id: number;
  nickname: string;
  steamid64: string | null;
  position: number;
}

interface TeamDetail {
  id: number;
  tournament_id: number;
  name: string;
  short_name: string | null;
  team_id: string | null;
  tournament_name?: string;
}

interface TournamentTeamSummary {
  id: number;
  status: string;
}

const POSITIONS = [1, 2, 3, 4, 5];
const STEAMID64_BASE = BigInt("76561197960265728");
const POSITION_LABELS: Record<number, string> = {
  1: "1号位 (Carry)",
  2: "2号位 (Mid)",
  3: "3号位 (Offlane)",
  4: "4号位 (Soft Support)",
  5: "5号位 (Hard Support)",
};

export default function TeamPage() {
  const router = useRouter();
  const params = useParams();
  const teamId = params.id as string;
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [editNickname, setEditNickname] = useState("");
  const [editSteamid64, setEditSteamid64] = useState("");
  const [editPosition, setEditPosition] = useState("");

  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addNickname, setAddNickname] = useState("");
  const [addSteamid64, setAddSteamid64] = useState("");
  const [addPosition, setAddPosition] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [teamRes, playersRes] = await Promise.all([
        fetch(apiPath(`/api/teams/${teamId}`)),
        fetch(apiPath(`/api/teams/${teamId}/players`)),
      ]);
      const teamData = await teamRes.json();
      const playersData = await playersRes.json();
      setTeam(teamData);
      setPlayers(playersData);
    } catch {
      toast.error("加载战队数据失败");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 获取已占用的位置
  const usedPositions = players.map((p) => p.position);

  // 校验函数
  const validatePlayer = (
    nickname: string,
    steamid64: string,
    position: number,
    excludePlayerId?: number,
    allowPositionConflict = false
  ): string | null => {
    if (!nickname.trim()) return "昵称不能为空";

    if (!POSITIONS.includes(position)) {
      return "请选择 1~5 号位";
    }

    if (steamid64 && !/^\d{17}$/.test(steamid64.trim())) {
      return `steamid64 格式错误（需为 17 位数字）`;
    }

    if (allowPositionConflict) return null;

    const duplicate = players.find(
      (p) =>
        p.position === position &&
        p.id !== excludePlayerId
    );
    if (duplicate) {
      return `${position}号位 已有选手「${duplicate.nickname}」，位置重复`;
    }

    return null;
  };

  // 打开编辑弹窗
  const openEdit = (player: Player) => {
    setEditingPlayer(player);
    setEditNickname(player.nickname);
    setEditSteamid64(player.steamid64 ?? "");
    setEditPosition(String(player.position));
    setEditOpen(true);
  };

  // 提交编辑
  const handleEdit = async () => {
    if (!editingPlayer) return;
    const pos = Number(editPosition);
    const err = validatePlayer(editNickname, editSteamid64, pos, editingPlayer.id, true);
    if (err) {
      toast.error(err);
      return;
    }

    const occupiedPlayer = players.find(
      (p) => p.position === pos && p.id !== editingPlayer.id
    );
    if (occupiedPlayer) {
      const shouldSwap = confirm(
        `当前 ${pos}号位 已由「${occupiedPlayer.nickname}」占用，是否与「${editingPlayer.nickname}」交换位置？`
      );
      if (!shouldSwap) return;
    }

    try {
      if (occupiedPlayer) {
        const swapRes = await fetch(apiPath(`/api/players/${occupiedPlayer.id}`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            position: editingPlayer.position,
          }),
        });
        if (!swapRes.ok) throw new Error("交换位置失败");
      }

      const res = await fetch(apiPath(`/api/players/${editingPlayer.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: editNickname.trim(),
          steamid64: editSteamid64.trim() || null,
          position: pos,
        }),
      });
      if (!res.ok) throw new Error("更新失败");
      toast.success(occupiedPlayer ? "选手位置已交换" : "选手已更新");
      setEditOpen(false);
      setSavedSuccess(false);
      await fetchData();
    } catch {
      toast.error("更新选手失败");
    }
  };

  // 打开添加弹窗
  const openAdd = () => {
    // 找一个空缺位置
    const available = POSITIONS.find((p) => !usedPositions.includes(p));
    setAddPosition(available ? String(available) : "");
    setAddNickname("");
    setAddSteamid64("");
    setAddOpen(true);
  };

  // 提交添加
  const handleAdd = async () => {
    const pos = Number(addPosition);
    if (!addNickname.trim()) {
      toast.error("昵称不能为空");
      return;
    }
    if (!pos || pos < 1 || pos > 5) {
      toast.error("请选择选手位置");
      return;
    }

    const err = validatePlayer(addNickname, addSteamid64, pos);
    if (err) {
      toast.error(err);
      return;
    }

    try {
      const res = await fetch(apiPath(`/api/teams/${teamId}/players`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: addNickname.trim(),
          steamid64: addSteamid64.trim() || null,
          position: pos,
        }),
      });
      if (!res.ok) throw new Error("添加失败");
      toast.success("选手已添加");
      setAddOpen(false);
      setSavedSuccess(false);
      await fetchData();
    } catch {
      toast.error("添加选手失败");
    }
  };

  // 删除选手
  const handleDeletePlayer = async (player: Player) => {
    if (!confirm(`确认移除选手「${player.nickname}」？`)) return;
    try {
      const res = await fetch(apiPath(`/api/players/${player.id}`), { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      toast.success("选手已移除");
      setSavedSuccess(false);
      await fetchData();
    } catch {
      toast.error("移除选手失败");
    }
  };

  // 保存校验 + 更新战队状态
  const handleSave = async () => {
    setSaving(true);

    // 校验
    const errors: string[] = [];

    // 1. 检查位置完整性
    const positions = players.map((p) => p.position);
    for (const pos of POSITIONS) {
      if (!positions.includes(pos)) {
        errors.push(`${pos}号位 为空`);
      }
    }

    // 2. 检查 steamid64 格式
    for (const p of players) {
      if (p.steamid64 && !/^\d{17}$/.test(p.steamid64)) {
        errors.push(`${p.nickname}(${p.position}号位) steamid64 格式错误`);
      }
    }

    // 3. 检查位置重复
    const posCount = new Map<number, number>();
    positions.forEach((pos) => {
      posCount.set(pos, (posCount.get(pos) || 0) + 1);
    });
    for (const [pos, count] of posCount) {
      if (count > 1) {
        errors.push(`${pos}号位 有 ${count} 名选手重复`);
      }
    }

    if (errors.length > 0) {
      setSaving(false);
      toast.error(
        <div>
          <p className="font-semibold mb-1">保存校验未通过：</p>
          <ul className="text-sm list-disc pl-4 space-y-0.5">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>,
        { duration: 6000 }
      );
      return;
    }

    // 更新战队状态
    const allFilled = positions.length === 5 && new Set(positions).size === 5;
    const hasDuplicates = new Set(positions).size < positions.length;
    let status = "缺失";
    if (allFilled) status = "完整";
    else if (hasDuplicates) status = "重复";
    else if (positions.length > 0) status = "待确认";

    try {
      await fetch(apiPath(`/api/teams/${teamId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      setSavedSuccess(true);
      toast.success(`${team?.name} 阵容已保存`);
    } catch {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  // 算出当前比赛有多少支待处理战队
  const [pendingTeamsCount, setPendingTeamsCount] = useState(0);
  const [tournamentTeams, setTournamentTeams] = useState<TournamentTeamSummary[]>([]);

  useEffect(() => {
    if (team) {
      fetch(apiPath(`/api/tournaments/${team.tournament_id}/teams`))
        .then((r) => r.json())
        .then((data: TournamentTeamSummary[]) => {
          setTournamentTeams(data);
          const pending = data.filter(
            (t) =>
              t.id !== Number(teamId) && (t.status === "缺失" || t.status === "待确认" || t.status === "重复")
          );
          setPendingTeamsCount(pending.length);
        })
        .catch(() => {});
    }
  }, [team, teamId, savedSuccess]);

  const getStratzLink = (steamid64: string | null) => {
    if (!steamid64) return null;
    if (!/^\d{17}$/.test(steamid64)) return null;
    const accountId = BigInt(steamid64) - STEAMID64_BASE;
    if (accountId <= BigInt(0)) return null;
    return `https://stratz.com/players/${accountId.toString()}`;
  };

  // 根据位置获取颜色
  const getPositionColor = (pos: number) => {
    const colors: Record<number, string> = {
      1: "from-red-500 to-orange-500",
      2: "from-orange-500 to-yellow-500",
      3: "from-yellow-500 to-green-500",
      4: "from-green-500 to-blue-500",
      5: "from-blue-500 to-purple-500",
    };
    return colors[pos] || "from-slate-500 to-slate-600";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <Toaster position="top-right" richColors />
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* 导航 */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-1">
            <ArrowLeft className="w-4 h-4" />
            返回
          </Button>
          <span className="text-slate-300">/</span>
          <button
            onClick={() => router.push(`/tournament/${team?.tournament_id}`)}
            className="text-sm text-indigo-600 hover:text-indigo-800"
          >
            战队列表
          </button>
          <span className="text-slate-300">/</span>
          <span className="text-sm font-medium text-slate-600">{team?.name}</span>
        </div>

        {/* 头部 */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <TeamLogo
              teamId={team?.team_id}
              name={team?.name ?? ""}
              shortName={team?.short_name}
              size={48}
              rounded="lg"
            />
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{team?.name}</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {players.length}/5 位选手 · 编辑 1~5 号位阵容
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={openAdd} className="gap-2">
              <Plus className="w-4 h-4" />
              添加选手
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="gap-2 bg-indigo-600 hover:bg-indigo-700"
            >
              <Save className="w-4 h-4" />
              {saving ? "保存中..." : "保存阵容"}
            </Button>
          </div>
        </div>

        {/* 选手卡片网格 */}
        {players.length === 0 ? (
          <div className="text-center py-24">
            <Users className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-600 mb-2">还没有选手</h2>
            <p className="text-slate-400 mb-6">点击「添加选手」开始组建 1~5 号位阵容</p>
            <Button variant="outline" onClick={openAdd} className="gap-2">
              <Plus className="w-4 h-4" />
              添加选手
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {players
              .sort((a, b) => a.position - b.position)
              .map((player) => {
                const stratzLink = getStratzLink(player.steamid64);
                return (
                  <Card
                    key={player.id}
                    className="border-slate-200 hover:shadow-md transition-all duration-200 group"
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-10 h-10 rounded-lg bg-gradient-to-br ${getPositionColor(player.position)} flex items-center justify-center text-white font-bold text-sm shadow-sm`}
                          >
                            {player.position}
                          </div>
                          <div>
                            <CardTitle className="text-base text-slate-800">
                              {player.nickname}
                            </CardTitle>
                            <p className="text-xs text-slate-400">
                              {POSITION_LABELS[player.position] || `${player.position}号位`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEdit(player)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeletePlayer(player)}
                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">SteamID64</span>
                          <code className="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-mono">
                            {player.steamid64 || "—"}
                          </code>
                        </div>
                        {stratzLink && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">STRATZ</span>
                            <a
                              href={stratzLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 text-xs"
                            >
                              查看资料 <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}

            {/* 空缺位置占位卡 */}
            {POSITIONS.filter((p) => !usedPositions.includes(p)).map((pos) => (
              <Card
                key={`empty-${pos}`}
                className="border-dashed border-2 border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-indigo-300 transition-all cursor-pointer"
                onClick={openAdd}
              >
                <CardContent className="py-8 text-center">
                  <div className="w-10 h-10 rounded-lg bg-slate-200 flex items-center justify-center mx-auto mb-2">
                    <span className="text-slate-500 font-bold text-sm">{pos}</span>
                  </div>
                  <p className="text-sm text-slate-400">{POSITION_LABELS[pos]}</p>
                  <p className="text-xs text-slate-300 mt-1">点击添加选手</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* 保存成功引导 */}
        {savedSuccess && (
          <Card className="mt-8 border-green-200 bg-green-50/50">
            <CardContent className="py-6">
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
                <div>
                  <h3 className="font-semibold text-green-800 text-lg">
                    {team?.name} 阵容已保存
                  </h3>
                  <p className="text-sm text-green-600">
                    所有校验已通过，阵容数据已更新
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                {pendingTeamsCount > 0 && (
                  <Button
                    variant="default"
                    className="bg-indigo-600 hover:bg-indigo-700 gap-2"
                    onClick={() => {
                      const next = tournamentTeams.find(
                        (t) =>
                          t.id !== Number(teamId) &&
                          (t.status === "缺失" || t.status === "待确认" || t.status === "重复")
                      );
                      if (next) {
                        setSavedSuccess(false);
                        router.push(`/team/${next.id}`);
                      }
                    }}
                  >
                    <Flag className="w-4 h-4" />
                    继续编辑下一队 ({pendingTeamsCount})
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    setSavedSuccess(false);
                    router.push(`/tournament/${team?.tournament_id}`);
                  }}
                >
                  返回战队列表
                </Button>
                <Button
                  variant="outline"
                  className="text-green-700 border-green-300 hover:bg-green-100 gap-2"
                  onClick={() => {
                    const scope = "tournament";
                    const id = team?.tournament_id;
                    window.open(`/api/export?scope=${scope}&id=${id}`, "_blank");
                    toast.success("正在导出 CSV");
                  }}
                >
                  导出当前比赛 CSV
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* 编辑弹窗 */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>编辑选手</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="edit_nickname">昵称</Label>
                <Input
                  id="edit_nickname"
                  value={editNickname}
                  onChange={(e) => setEditNickname(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_steamid">SteamID64</Label>
                <Input
                  id="edit_steamid"
                  placeholder="17 位数字"
                  value={editSteamid64}
                  onChange={(e) => setEditSteamid64(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_position">位置</Label>
                <Select value={editPosition} onValueChange={setEditPosition}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择位置" />
                  </SelectTrigger>
                  <SelectContent>
                    {POSITIONS.map((pos) => (
                      <SelectItem key={pos} value={String(pos)}>
                        {POSITION_LABELS[pos]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                取消
              </Button>
              <Button onClick={handleEdit}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 添加弹窗 */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>添加选手</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="add_nickname">昵称 *</Label>
                <Input
                  id="add_nickname"
                  placeholder="选手昵称"
                  value={addNickname}
                  onChange={(e) => setAddNickname(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add_steamid">SteamID64</Label>
                <Input
                  id="add_steamid"
                  placeholder="17 位数字"
                  value={addSteamid64}
                  onChange={(e) => setAddSteamid64(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add_position">位置 *</Label>
                <Select value={addPosition} onValueChange={setAddPosition}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择位置" />
                  </SelectTrigger>
                  <SelectContent>
                    {POSITIONS.map((pos) => (
                      <SelectItem key={pos} value={String(pos)}>
                        {POSITION_LABELS[pos]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>
                取消
              </Button>
              <Button onClick={handleAdd}>添加</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}