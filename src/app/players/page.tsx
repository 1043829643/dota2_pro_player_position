"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiPath } from "@/lib/base-path";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast, Toaster } from "sonner";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Search,
  UserCog,
  Save,
} from "lucide-react";

interface PlayerCard {
  player_id: number;
  steamid64: string;
  nickname: string;
  position: number;
  tournament_id: number;
  tournament_name: string;
  league_id: string;
  event_tier: string;
  team_record_id: number;
  team_name: string;
  team_tag: string | null;
}

interface PlayerProfile {
  steamid64: string;
  nickname: string;
  appearances: PlayerCard[];
}

export default function PlayersPage() {
  const router = useRouter();
  const [cards, setCards] = useState<PlayerCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [tierFilter, setTierFilter] = useState<"全部" | "顶级赛事" | "预选赛">("全部");
  const [keyword, setKeyword] = useState("");
  const [selectedSteamid, setSelectedSteamid] = useState("");
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [positionDraft, setPositionDraft] = useState<Record<number, string>>({});

  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
      if (tierFilter === "全部") return true;
      return card.event_tier === tierFilter;
    });
  }, [cards, tierFilter]);

  const groupedCards = useMemo(() => {
    const groups = new Map<string, { title: string; items: PlayerCard[] }>();
    for (const card of filteredCards) {
      const key = `${card.tournament_name}__${card.team_name}`;
      if (!groups.has(key)) {
        groups.set(key, {
          title: `${card.tournament_name} / ${card.team_name}`,
          items: [],
        });
      }
      groups.get(key)!.items.push(card);
    }
    return Array.from(groups.values());
  }, [filteredCards]);

  const filteredPlayerOrder = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const card of filteredCards) {
      if (!seen.has(card.steamid64)) {
        seen.add(card.steamid64);
        list.push(card.steamid64);
      }
    }
    return list;
  }, [filteredCards]);

  const currentIndex = useMemo(
    () => filteredPlayerOrder.findIndex((id) => id === selectedSteamid),
    [filteredPlayerOrder, selectedSteamid]
  );

  async function fetchCards() {
    setLoadingCards(true);
    try {
      const res = await fetch(apiPath("/api/player-management/cards"));
      if (!res.ok) throw new Error("加载选手卡片失败");
      const data = await res.json();
      setCards(data.cards ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoadingCards(false);
    }
  }

  async function fetchProfile(steamid64: string) {
    if (!/^\d{17}$/.test(steamid64)) {
      toast.error("请输入 17 位 SteamID64");
      return;
    }
    setLoadingProfile(true);
    try {
      const res = await fetch(
        `/api/player-management/profile?steamid64=${encodeURIComponent(steamid64)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载选手信息失败");
      const profileData = data as PlayerProfile;
      setSelectedSteamid(profileData.steamid64);
      setKeyword(profileData.steamid64);
      setProfile(profileData);
      setNicknameDraft(profileData.nickname);
      setPositionDraft(
        Object.fromEntries(
          profileData.appearances.map((a) => [a.player_id, String(a.position)])
        )
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoadingProfile(false);
    }
  }

  useEffect(() => {
    fetchCards();
  }, []);

  async function handleSaveNickname() {
    if (!profile) return;
    if (!nicknameDraft.trim()) {
      toast.error("昵称不能为空");
      return;
    }
    const res = await fetch(apiPath("/api/player-management/profile"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_nickname",
        steamid64: profile.steamid64,
        nickname: nicknameDraft.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "昵称保存失败");
      return;
    }
    toast.success("昵称已同步到该选手全部联赛");
    await fetchCards();
    await fetchProfile(profile.steamid64);
  }

  async function handleSavePosition(appearance: PlayerCard) {
    const targetPosition = Number(positionDraft[appearance.player_id] ?? appearance.position);
    if (targetPosition === appearance.position) {
      toast.message("位置未变化");
      return;
    }

    const occupied = profile?.appearances.find(
      (a) =>
        a.team_record_id === appearance.team_record_id &&
        a.player_id !== appearance.player_id &&
        Number(positionDraft[a.player_id] ?? a.position) === targetPosition
    );

    if (occupied) {
      const ok = confirm(
        `${appearance.tournament_name} / ${appearance.team_name} 中，${targetPosition}号位当前为 ${occupied.nickname}。是否交换位置？`
      );
      if (!ok) return;
    }

    const res = await fetch(apiPath("/api/player-management/profile"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_position",
        player_id: appearance.player_id,
        target_position: targetPosition,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "位置更新失败");
      return;
    }
    toast.success(occupied ? "位置已交换" : "位置已更新");
    if (selectedSteamid) {
      await fetchProfile(selectedSteamid);
    }
    await fetchCards();
  }

  function goPrevNext(step: -1 | 1) {
    if (currentIndex < 0) return;
    const nextIndex = currentIndex + step;
    if (nextIndex < 0 || nextIndex >= filteredPlayerOrder.length) return;
    void fetchProfile(filteredPlayerOrder[nextIndex]);
  }

  const visibleAppearances = useMemo(() => {
    if (!profile) return [];
    return profile.appearances.filter((a) => {
      if (tierFilter === "全部") return true;
      return a.event_tier === tierFilter;
    });
  }, [profile, tierFilter]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <Toaster position="top-right" richColors />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="sm" onClick={() => router.push("/")} className="gap-1">
            <ArrowLeft className="w-4 h-4" />
            返回首页
          </Button>
          <span className="text-slate-300">/</span>
          <span className="text-sm font-medium text-slate-600">选手管理</span>
        </div>

        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 text-white p-3 rounded-xl shadow-md">
              <UserCog className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">选手管理</h1>
              <p className="text-sm text-slate-500">按 SteamID64 管理选手参赛联赛、战队与位置</p>
            </div>
          </div>
        </div>

        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="flex gap-3">
                <Input
                  placeholder="输入 17 位 SteamID64（例如 76561198113227791）"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
                <Button className="gap-2" onClick={() => void fetchProfile(keyword.trim())}>
                  <Search className="w-4 h-4" />
                  定位选手
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedSteamid("");
                    setProfile(null);
                    setKeyword("");
                  }}
                >
                  清空
                </Button>
              </div>
              <div className="flex items-center gap-2">
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
            </div>
          </CardContent>
        </Card>

        {selectedSteamid && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>选手详情</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentIndex <= 0}
                    onClick={() => goPrevNext(-1)}
                    className="gap-1"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    上一个
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      currentIndex < 0 || currentIndex >= filteredPlayerOrder.length - 1
                    }
                    onClick={() => goPrevNext(1)}
                    className="gap-1"
                  >
                    下一个
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loadingProfile ? (
                <Skeleton className="h-28 rounded-lg" />
              ) : profile ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <p className="text-xs text-slate-500 mb-1">SteamID64</p>
                      <code className="bg-slate-100 px-2 py-1 rounded text-xs">
                        {profile.steamid64}
                      </code>
                    </div>
                    <div className="flex-1 min-w-[220px]">
                      <p className="text-xs text-slate-500 mb-1">昵称（修改后影响全部联赛）</p>
                      <Input
                        value={nicknameDraft}
                        onChange={(e) => setNicknameDraft(e.target.value)}
                      />
                    </div>
                    <Button className="gap-2" onClick={() => void handleSaveNickname()}>
                      <Save className="w-4 h-4" />
                      保存昵称
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {visibleAppearances.map((a) => (
                      <Card key={a.player_id} className="border-slate-200">
                        <CardContent className="pt-4">
                          <div className="flex flex-wrap items-center gap-3 justify-between">
                            <div className="space-y-1">
                              <div className="font-medium text-slate-800">{a.tournament_name}</div>
                              <div className="text-sm text-slate-500">
                                {a.team_name} {a.team_tag ? `(${a.team_tag})` : ""}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline">当前 {a.position} 号位</Badge>
                              <Select
                                value={positionDraft[a.player_id] ?? String(a.position)}
                                onValueChange={(v) =>
                                  setPositionDraft((prev) => ({ ...prev, [a.player_id]: v }))
                                }
                              >
                                <SelectTrigger className="w-36">
                                  <SelectValue placeholder="选择位置" />
                                </SelectTrigger>
                                <SelectContent>
                                  {[1, 2, 3, 4, 5].map((pos) => (
                                    <SelectItem key={pos} value={String(pos)}>
                                      {pos} 号位
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                size="sm"
                                className="gap-1"
                                onClick={() => void handleSavePosition(a)}
                              >
                                <Save className="w-3 h-3" />
                                保存位置
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                    {visibleAppearances.length === 0 && (
                      <p className="text-sm text-slate-500">当前筛选下无该选手参赛记录</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">未找到该选手</p>
              )}
            </CardContent>
          </Card>
        )}

        {!selectedSteamid && (
          <div>
            <h2 className="text-lg font-semibold text-slate-800 mb-4">
              按联赛/队伍展示选手卡片（点击直接管理）
            </h2>
            {loadingCards ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <Skeleton key={i} className="h-28 rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                {groupedCards.map((group) => (
                  <div key={group.title}>
                    <h3 className="text-sm font-semibold text-slate-600 mb-2">{group.title}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {group.items.map((card) => (
                        <Card
                          key={card.player_id}
                          className="cursor-pointer hover:shadow-md transition"
                          onClick={() => void fetchProfile(card.steamid64)}
                        >
                          <CardContent className="pt-4 space-y-1">
                            <div className="font-semibold text-slate-800">{card.nickname}</div>
                            <div className="text-xs text-slate-500">{card.steamid64}</div>
                            <div className="text-xs text-slate-500">
                              {card.team_name} · {card.position}号位
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
