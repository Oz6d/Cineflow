import { useEffect, useState } from "react";
import clsx from "clsx";
import { FolderCog, FolderOpen } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";
import { DirectoryPicker } from "./DirectoryPicker";
import { Button, Field, Modal, Spinner, Switch } from "./ui";

type TargetMode = "category" | "show";

type WorkTarget = {
  path: string;
  mode: TargetMode;
};

type MoveResult = {
  moved?: { from: string; to: string }[];
  skipped?: { path: string; reason: string }[];
  failed?: { path: string; error: string }[];
  updated?: number;
};

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}

function modeLabel(target: WorkTarget | null) {
  if (!target) return "自动分类";
  if (target.mode === "show") return `作品文件夹：${target.path}`;
  return `分类：${target.path || "整理后目录根目录"}`;
}

/**
 * 调整整部作品的整理位置。
 * 分类模式只固定分类目录，作品文件夹继续自动生成；作品文件夹模式则整部作品固定到一个文件夹。
 */
export function WorkTargetModal({
  open,
  libraryId,
  sourceId,
  itemId,
  matchKey,
  title,
  currentPath,
  onClose,
  onSaved,
}: {
  open: boolean;
  libraryId: number;
  sourceId: number;
  itemId?: number;
  matchKey?: string;
  title?: string;
  currentPath?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [targetRoot, setTargetRoot] = useState("");
  const [current, setCurrent] = useState<WorkTarget | null>(null);
  const [mode, setMode] = useState<TargetMode>("category");
  const [path, setPath] = useState("");
  const [picker, setPicker] = useState(false);
  const [moveExisting, setMoveExisting] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    const query = itemId
      ? `item_id=${itemId}`
      : `match_key=${encodeURIComponent(matchKey || "")}`;
    setLoading(true);
    setLoadError("");
    setError("");
    setPicker(false);
    setMoveExisting(false);
    setCurrent(null);
    setTargetRoot("");
    setMode("category");
    setPath("");
    api
      .get<{ target_root: string; target: WorkTarget | null }>(
        `/api/libraries/${libraryId}/work-target?${query}`,
      )
      .then((data) => {
        if (!mounted) return;
        setTargetRoot(data.target_root || "");
        setCurrent(data.target);
        if (data.target) {
          setMode(data.target.mode);
          setPath(data.target.path);
        }
      })
      .catch((err) => {
        if (mounted) setLoadError(err instanceof Error ? err.message : "读取整理位置失败");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [open, libraryId, itemId, matchKey]);

  const root = trimSlashes(targetRoot);
  const fullPath = (relative: string) => {
    const value = trimSlashes(relative);
    if (!root) return value;
    return value ? `${root}/${value}` : root;
  };
  const toRelative = (value: string) => {
    const clean = trimSlashes(value);
    if (!root) return clean;
    if (clean === root) return "";
    if (clean.startsWith(`${root}/`)) return clean.slice(root.length + 1);
    return clean;
  };

  const chooseMode = (next: TargetMode) => {
    if (next === mode) return;
    setMode(next);
    setError("");
    // 分类目录和作品文件夹的含义不同，切换后让用户重新确认位置。
    setPath(next === current?.mode ? current.path : "");
  };

  const save = async () => {
    if (busy) return;
    if (!root) {
      setError("请先到影视库设置里填写整理后目录");
      return;
    }
    if (mode === "show" && !path.trim()) {
      setError("请选择作品文件夹");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.put<{
        target: WorkTarget;
        move: MoveResult | null;
        move_error?: string;
      }>(`/api/libraries/${libraryId}/work-target`, {
        item_id: itemId,
        match_key: matchKey || "",
        path,
        mode,
        move_existing: moveExisting,
      });
      if (result.move_error) {
        toast.error(`位置已保存，但移动已整理文件失败：${result.move_error}`);
      } else if (result.move) {
        const moved = result.move.moved?.length || 0;
        if (moved) {
          toast.success(`已保存整理位置，并移动 ${moved} 个文件或文件夹`);
        } else {
          toast.success("已保存整理位置");
        }
        const skipped = result.move.skipped || [];
        const conflicts = skipped.filter((entry) =>
          (entry.reason || "").includes("同名"),
        ).length;
        const otherSkipped = skipped.length - conflicts;
        if (conflicts) {
          toast.push(`有 ${conflicts} 个同名文件未覆盖，已保留原文件`);
        }
        if (otherSkipped) {
          toast.push(`有 ${otherSkipped} 个文件没有移动，已保留在原位置`);
        }
        if (result.move.failed?.length) {
          toast.push(`有 ${result.move.failed.length} 个文件移动失败，可在任务记录中查看`);
        }
      } else {
        toast.success("已保存整理位置");
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const query = itemId
        ? `item_id=${itemId}`
        : `match_key=${encodeURIComponent(matchKey || "")}`;
      await api.del(`/api/libraries/${libraryId}/work-target?${query}`);
      toast.success("已恢复自动分类");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setBusy(false);
    }
  };

  const displayPath =
    mode === "category"
      ? path || (root ? "整理后目录根目录" : "尚未设置")
      : path || "尚未选择";

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="调整整理位置"
      width="max-w-xl"
      footer={
        <>
          {current ? (
            <Button className="mr-auto" onClick={() => void restore()} disabled={busy || loading}>
              恢复自动分类
            </Button>
          ) : null}
          <Button
            variant="primary"
            loading={busy}
            disabled={loading || !root}
            onClick={() => void save()}
          >
            保存位置
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex h-32 items-center justify-center gap-2 text-sm text-slate-400">
          <Spinner /> 正在读取当前整理位置…
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.08] px-3.5 py-3 text-xs text-rose-200">
          {loadError}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-[11px] leading-relaxed">
            {title ? (
              <div className="text-[12px] text-slate-200">
                作品：<span className="text-white">{title}</span>
              </div>
            ) : null}
            {currentPath ? (
              <div className="mt-1 break-all font-mono text-[10px] text-slate-500">
                当前整理到：{currentPath}
              </div>
            ) : null}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-px text-[10px] text-slate-500">位置</span>
              <span className="min-w-0 break-all text-slate-300">{modeLabel(current)}</span>
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              这个设置只影响这部作品；之后订阅更新、替换旧集也会沿用。
            </div>
          </div>

          {!root ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-2.5 text-[11px] text-amber-200">
              这个影视库还没有填写整理后目录，请先到影视库设置里选择，再调整整理位置。
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              className={clsx(
                "rounded-xl border px-3.5 py-3 text-left transition",
                mode === "category"
                  ? "border-mint-500/50 bg-mint-500/[0.08]"
                  : "border-white/[0.07] bg-white/[0.02] hover:border-white/15",
              )}
              onClick={() => chooseMode("category")}
            >
              <div className="flex items-center gap-1.5 text-[13px] text-slate-100">
                <FolderOpen size={14} className={mode === "category" ? "text-mint-300" : "text-slate-500"} />
                按分类放置
              </div>
              <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                只固定分类目录，作品文件夹仍自动创建。
              </div>
            </button>
            <button
              type="button"
              className={clsx(
                "rounded-xl border px-3.5 py-3 text-left transition",
                mode === "show"
                  ? "border-mint-500/50 bg-mint-500/[0.08]"
                  : "border-white/[0.07] bg-white/[0.02] hover:border-white/15",
              )}
              onClick={() => chooseMode("show")}
            >
              <div className="flex items-center gap-1.5 text-[13px] text-slate-100">
                <FolderCog size={14} className={mode === "show" ? "text-mint-300" : "text-slate-500"} />
                指定作品文件夹
              </div>
              <div className="mt-1 text-[11px] leading-relaxed text-slate-500">
                文件直接放进这个文件夹，剧集仍按季分子文件夹。
              </div>
            </button>
          </div>

          <Field
            label={mode === "category" ? "分类目录" : "作品文件夹"}
            hint={
              mode === "category"
                ? "在整理后目录里选择分类。例如选择「动漫/日漫」，新集仍会进入「作品名 (年份)」文件夹。"
                : "在整理后目录里选择这部作品自己的文件夹。如果还没有，可以在选择窗口里新建。"
            }
          >
            <div className="flex gap-2">
              <div className="input flex min-w-0 flex-1 items-center truncate font-mono text-[11px] text-slate-300">
                {displayPath}
              </div>
              <Button
                type="button"
                className="shrink-0 px-3"
                disabled={!root || busy}
                onClick={() => setPicker(true)}
              >
                <FolderOpen size={14} /> 浏览选择
              </Button>
            </div>
          </Field>

          <Switch
            checked={moveExisting}
            onChange={setMoveExisting}
            disabled={busy}
            label="同时移动这部作品已整理的文件"
            hint="把已经整理到别处的集也移到新位置；字幕、海报等会尽量一起移动，目标已有同名文件时不会覆盖。"
          />

          {error ? (
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.08] px-3.5 py-2.5 text-[11px] text-rose-200">
              {error}
            </div>
          ) : null}
        </div>
      )}

      {picker && root ? (
        <DirectoryPicker
          sourceId={sourceId}
          title={mode === "category" ? "选择分类目录" : "选择作品文件夹"}
          rootPath={root}
          initialPath={fullPath(path)}
          onSelect={(value) => {
            setPath(toRelative(value));
            setError("");
          }}
          onClose={() => setPicker(false)}
        />
      ) : null}
    </Modal>
  );
}
