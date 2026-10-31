import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";
import type { MediaItem } from "../types";
import { DirectoryPicker } from "./DirectoryPicker";
import { Button, Field, Modal } from "./ui";

type MoveResult = {
  moved?: { from: string; to: string }[];
  skipped?: { path: string; reason: string }[];
  failed?: { path: string; error: string }[];
  updated?: number;
};

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, "");
}

/**
 * 调整单个文件的存放位置。
 * 只影响当前文件，不改变整部作品的设置；已整理文件保存后会立即移动。
 */
export function ItemTargetModal({
  open,
  item,
  sourceId,
  targetRoot,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: MediaItem | null;
  sourceId: number;
  targetRoot: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [path, setPath] = useState("");
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const root = trimSlashes(targetRoot);

  useEffect(() => {
    if (!open) return;
    setPath(trimSlashes(item?.target_dir_override || ""));
    setPicker(false);
    setError("");
  }, [open, item?.id, item?.target_dir_override]);

  if (!item) return null;

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

  const save = async () => {
    if (busy) return;
    if (!root) {
      setError("请先到影视库设置里填写整理后目录");
      return;
    }
    if (!path.trim()) {
      setError("请选择存放文件夹");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.put<{
        move: MoveResult | null;
        move_error?: string;
      }>(`/api/items/${item.id}/location`, {
        path,
        move_existing: true,
      });
      if (result.move_error) {
        toast.error(`位置已保存，但移动文件失败：${result.move_error}`);
      } else if (result.move) {
        const moved = result.move.moved?.length || 0;
        if (moved) {
          toast.success(`已保存位置，并移动 ${moved} 个文件`);
        } else {
          toast.success("已保存这个文件的位置");
        }
        const conflicts = (result.move.skipped || []).filter((entry) =>
          (entry.reason || "").includes("同名"),
        ).length;
        if (conflicts) {
          toast.push(`有 ${conflicts} 个同名文件未覆盖，已保留原文件`);
        }
        if (result.move.failed?.length) {
          toast.push(`有 ${result.move.failed.length} 个文件移动失败`);
        }
      } else {
        toast.success("已保存这个文件的位置");
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
      await api.del(`/api/items/${item.id}/location`);
      toast.success("已恢复跟随作品位置");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) onClose();
      }}
      title="调整这个文件的位置"
      width="max-w-lg"
      footer={
        <>
          {item.target_dir_override ? (
            <Button className="mr-auto" onClick={() => void restore()} disabled={busy}>
              恢复跟随作品
            </Button>
          ) : null}
          <Button
            variant="primary"
            loading={busy}
            disabled={!root}
            onClick={() => void save()}
          >
            保存位置
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-[11px] leading-relaxed">
          <div className="break-all text-[12px] text-slate-200">{item.planned_name || item.file_name}</div>
          {item.target_path ? (
            <div className="mt-1 break-all font-mono text-[10px] text-slate-500">
              当前在：{item.target_path}
            </div>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-px text-[10px] text-slate-500">位置</span>
            <span className="min-w-0 break-all text-slate-300">
              {item.target_dir_override ? `单独指定：${item.target_dir_override}` : "跟随作品位置"}
            </span>
          </div>
          <div className="mt-1 text-[10px] text-slate-500">
            只影响这个文件；已整理的文件保存后会立即移动，同名文件不会覆盖。
          </div>
        </div>

        {!root ? (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-2.5 text-[11px] text-amber-200">
            这个影视库还没有填写整理后目录，请先到影视库设置里选择。
          </div>
        ) : null}

        <Field label="存放文件夹" hint="选择后，这个文件会直接放进该文件夹。">
          <div className="flex gap-2">
            <div className="input flex min-w-0 flex-1 items-center truncate font-mono text-[11px] text-slate-300">
              {path || (root ? "尚未选择" : "尚未设置整理后目录")}
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

        {error ? (
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.08] px-3.5 py-2.5 text-[11px] text-rose-200">
            {error}
          </div>
        ) : null}
      </div>

      {picker && root ? (
        <DirectoryPicker
          sourceId={sourceId}
          title="选择存放文件夹"
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
