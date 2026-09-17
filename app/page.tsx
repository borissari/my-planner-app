"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import confetti from "canvas-confetti";
import { supabase } from "./supabase";

const TASK_FIELDS = "id, title, completed, created_at, type, due_date, parent_id";
const categories = ["Spatial", "Design", "Drawing", "LAS", "THAD", "others"] as const;
type Category = (typeof categories)[number];
type Filter = "all" | "active" | "completed";

type Task = {
  id: number | string;
  title: string;
  completed: boolean;
  created_at?: string;
  type?: Category | string | null;
  due_date?: string | null;
  parent_id?: number | string | null;
};

const categoryStyles: Record<string, string> = {
  Spatial: "bg-[#e5f1ef] text-[#40766e]",
  Design: "bg-[#eee9fb] text-[#69539b]",
  Drawing: "bg-[#f9e8e1] text-[#a25f4a]",
  LAS: "bg-[#e7eef8] text-[#4f6f9c]",
  THAD: "bg-[#f8edcf] text-[#937331]",
  others: "bg-[#ecece8] text-[#686f67]",
};

const confettiColors = ["#F59E0B", "#8B5CF6", "#EC4899", "#10B981"];

function formatDueDate(date: string | null | undefined) {
  if (!date) return null;
  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(d);
  } catch {
    return null;
  }
}

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState("");
  const [newCategory, setNewCategory] = useState<Category>("Spatial");
  const [newDueDate, setNewDueDate] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedTask, setExpandedTask] = useState<number | string | null>(null);
  const [subtaskInputs, setSubtaskInputs] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadTasks() {
      const { data, error: fetchError } = await supabase.from("tasks").select(TASK_FIELDS).order("created_at", { ascending: false });
      if (fetchError) setError(fetchError.message);
      else setTasks((data as Task[]) ?? []);
      setIsLoading(false);
    }
    loadTasks();
  }, []);

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newTask.trim();
    if (!title || isSaving) return;
    setIsSaving(true);
    setError("");
    const { data, error: insertError } = await supabase.from("tasks").insert({ title, completed: false, type: newCategory, due_date: newDueDate || null }).select(TASK_FIELDS).single();
    if (insertError) setError(insertError.message);
    else if (data) {
      setTasks((currentTasks) => [data as Task, ...currentTasks]);
      setNewTask("");
      setNewDueDate("");
    }
    setIsSaving(false);
  }

  async function addSubtask(event: FormEvent<HTMLFormElement>, parentId: number | string) {
    event.preventDefault();
    const inputKey = String(parentId);
    const title = (subtaskInputs[inputKey] ?? "").trim();
    if (!title) return;
    setError("");
    const { data, error: insertError } = await supabase.from("tasks").insert({ title, completed: false, parent_id: parentId }).select(TASK_FIELDS).single();
    if (insertError) setError(insertError.message);
    else if (data) {
      setTasks((currentTasks) => [...currentTasks, data as Task]);
      setSubtaskInputs((currentInputs) => ({ ...currentInputs, [inputKey]: "" }));
    }
  }

  async function toggleTask(task: Task) {
    setError("");
    const nextCompleted = !task.completed;
    if (nextCompleted) {
      const clearsTaskList = !tasks.some((currentTask) => currentTask.id !== task.id && !currentTask.completed);
      if (clearsTaskList) {
        void playVictoryFanfare();
        triggerVictoryConfetti();
      } else {
        void playCompletionChime();
        triggerCompletionConfetti();
      }
    }
    setTasks((currentTasks) => currentTasks.map((currentTask) => currentTask.id === task.id ? { ...currentTask, completed: nextCompleted } : currentTask));
    const { error: updateError } = await supabase.from("tasks").update({ completed: nextCompleted }).eq("id", task.id);
    if (updateError) {
      setTasks((currentTasks) => currentTasks.map((currentTask) => currentTask.id === task.id ? { ...currentTask, completed: task.completed } : currentTask));
      setError(updateError.message);
    }
  }

  async function deleteTask(task: Task) {
    setError("");
    const childIds = tasks.filter((currentTask) => String(currentTask.parent_id) === String(task.id)).map((child) => child.id);
    const taskIds = [task.id, ...childIds];
    const { error: deleteError } = await supabase.from("tasks").delete().in("id", taskIds);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setTasks((currentTasks) => currentTasks.filter((currentTask) => !taskIds.includes(currentTask.id)));
    if (expandedTask === task.id) setExpandedTask(null);
  }

  function createImpulseResponse(audioContext: AudioContext) {
    const duration = 1.2;
    const impulse = audioContext.createBuffer(2, audioContext.sampleRate * duration, audioContext.sampleRate);

    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const channelData = impulse.getChannelData(channel);
      for (let index = 0; index < channelData.length; index += 1) {
        const decay = Math.pow(1 - index / channelData.length, 3.5);
        const noise = Math.sin((index + 1) * (channel + 1) * 12.9898) * 43758.5453;
        channelData[index] = (noise - Math.floor(noise) - 0.5) * decay * 0.9;
      }
    }

    return impulse;
  }

  async function createReverbAudioContext() {
    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;

    const audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") await audioContext.resume();
    const convolver = audioContext.createConvolver();
    convolver.buffer = createImpulseResponse(audioContext);
    convolver.connect(audioContext.destination);
    return { audioContext, convolver };
  }

  function scheduleReverbNote(audioContext: AudioContext, convolver: ConvolverNode, frequency: number, startTime: number, duration: number, volume = 0.07, wave: OscillatorType = "square") {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const endTime = startTime + duration;
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);
    oscillator.connect(gain);
    gain.connect(convolver);
    oscillator.start(startTime);
    oscillator.stop(endTime);
  }

  async function playCompletionChime() {
    try {
      const reverb = await createReverbAudioContext();
      if (!reverb) return;
      const { audioContext, convolver } = reverb;

      const startTime = audioContext.currentTime;
      const frequencies = [523.25, 659.25, 783.99, 1046.5];
      const noteSpacing = 0.05;
      const noteDuration = 0.16;

      frequencies.forEach((frequency, index) => {
        scheduleReverbNote(audioContext, convolver, frequency, startTime + index * noteSpacing, noteDuration);
      });

      window.setTimeout(() => void audioContext.close(), 1500);
    } catch {
      // Audio is optional and can be blocked by browser permissions.
    }
  }

  async function playVictoryFanfare() {
    try {
      const reverb = await createReverbAudioContext();
      if (!reverb) return;
      const { audioContext, convolver } = reverb;
      const startTime = audioContext.currentTime;
      const arpeggio = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
      const noteSpacing = 0.12;

      arpeggio.forEach((frequency, index) => {
        scheduleReverbNote(audioContext, convolver, frequency, startTime + index * noteSpacing, 0.3, 0.08, "triangle");
      });

      const chordStart = startTime + arpeggio.length * noteSpacing + 0.04;
      [523.25, 659.25, 783.99].forEach((frequency) => {
        scheduleReverbNote(audioContext, convolver, frequency, chordStart, 1.1, 0.055, "triangle");
      });

      window.setTimeout(() => void audioContext.close(), 2800);
    } catch {
      // Audio is optional and can be blocked by browser permissions.
    }
  }

  function triggerCompletionConfetti() {
    const origin = { x: 0.5, y: 0.48 };
    void confetti({
      particleCount: 40,
      spread: 55,
      startVelocity: 35,
      origin,
      colors: confettiColors,
    });
    window.setTimeout(() => {
      void confetti({
        particleCount: 60,
        spread: 100,
        decay: 0.92,
        scalar: 1.1,
        origin,
        colors: confettiColors,
      });
    }, 100);
  }

  function triggerVictoryConfetti() {
    void confetti({
      particleCount: 220,
      spread: 160,
      startVelocity: 52,
      scalar: 1.2,
      ticks: 240,
      origin: { x: 0.5, y: 0.52 },
      colors: confettiColors,
    });
    window.setTimeout(() => {
      void confetti({
        particleCount: 140,
        spread: 100,
        startVelocity: 28,
        decay: 0.91,
        scalar: 1.05,
        origin: { x: 0.2, y: 0.72 },
        colors: confettiColors,
      });
      void confetti({
        particleCount: 140,
        spread: 100,
        startVelocity: 28,
        decay: 0.91,
        scalar: 1.05,
        origin: { x: 0.8, y: 0.72 },
        colors: confettiColors,
      });
    }, 140);
  }

  const mainTasks = tasks.filter((task) => !task.parent_id);
  const visibleTasks = useMemo(() => mainTasks.filter((task) => filter === "all" || (filter === "completed" ? task.completed : !task.completed)), [mainTasks, filter]);
  const completedCount = mainTasks.filter((task) => task.completed).length;
  const filterLabels: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
    { value: "completed", label: "Completed" },
  ];

  return (
    <main className="min-h-screen bg-[#f5f4ef] px-5 py-8 text-[#20231f] sm:px-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-[#73786d]">Daily focus</p>
            <h1 className="font-serif text-5xl leading-none tracking-tight text-[#20231f] sm:text-6xl">Your tasks.</h1>
          </div>
          <div className="rounded-full border border-[#d8d8ce] bg-white/60 px-4 py-2 text-right">
            <p className="text-2xl font-semibold leading-none">{completedCount}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-[#73786d]">done</p>
          </div>
        </header>

        <form onSubmit={addTask} className="mb-5 rounded-2xl border border-[#deded4] bg-white p-3 shadow-[0_12px_30px_rgba(43,48,37,0.06)]">
          <div className="flex gap-2">
            <input value={newTask} onChange={(event) => setNewTask(event.target.value)} placeholder="What needs your attention?" aria-label="New task" className="min-w-0 flex-1 bg-transparent px-3 text-base outline-none placeholder:text-[#a1a59c]" />
            <button type="submit" disabled={isSaving || !newTask.trim()} className="rounded-xl bg-[#26382c] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#38513f] disabled:cursor-not-allowed disabled:opacity-40">{isSaving ? "Adding" : "Add task"}</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#f0f0e9] pt-3">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-[#8b9085]">Tag</span>
            {categories.map((category) => <button key={category} type="button" onClick={() => setNewCategory(category)} className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${newCategory === category ? `${categoryStyles[category]} ring-2 ring-current/20` : "bg-[#f3f3ed] text-[#858a80] hover:bg-[#eaeae2]"}`}>{category}</button>)}
            <label className="ml-auto flex items-center gap-2 text-xs text-[#73786d"><span>Due</span><input type="date" value={newDueDate} onChange={(event) => setNewDueDate(event.target.value)} className="rounded-lg border border-[#deded4] bg-[#fafaf7] px-2 py-1.5 text-xs text-[#4b5149] outline-none focus:border-[#8b9c8d]" /></label>
          </div>
        </form>

        {error && <p className="mb-5 rounded-xl bg-[#f7dfd8] px-4 py-3 text-sm text-[#8d3e2e]">{error}</p>}

        <section aria-label="Task list" className="overflow-hidden rounded-2xl border border-[#deded4] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#ecece5] px-5 py-3">
            <div className="flex gap-1 rounded-xl bg-[#f4f4ee] p-1" role="tablist" aria-label="Filter tasks">
              {filterLabels.map((item) => <button key={item.value} type="button" role="tab" aria-selected={filter === item.value} onClick={() => setFilter(item.value)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${filter === item.value ? "bg-white text-[#26382c] shadow-sm" : "text-[#8b9085] hover:text-[#4c554c]"}`}>{item.label}</button>)}
            </div>
            <span className="text-xs text-[#8b9085]">{visibleTasks.length} shown</span>
          </div>
          {isLoading ? <p className="px-5 py-12 text-center text-sm text-[#8b9085]">Loading your tasks...</p> : visibleTasks.length === 0 ? <p className="px-5 py-12 text-center text-sm text-[#8b9085]">{filter === "all" ? "Your list is clear. Add something worth doing." : `No ${filter} tasks right now.`}</p> : (
            <ul>
              {visibleTasks.map((task) => {
                const subtasks = tasks.filter((subtask) => String(subtask.parent_id) === String(task.id));
                const isExpanded = expandedTask === task.id;
                return (
                  <li key={task.id} className="relative border-b border-[#ecece5] px-5 py-4 last:border-b-0 transition-colors hover:bg-[#fdfdf9]">
                    <div className="flex items-start gap-4">
                      <button type="button" onClick={() => toggleTask(task)} aria-label={task.completed ? `Mark ${task.title} as incomplete` : `Mark ${task.title} as complete`} className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${task.completed ? "border-[#6d8a72] bg-[#6d8a72] text-white" : "border-[#b8bdb4] hover:border-[#26382c]"}`}>{task.completed && <span aria-hidden="true" className="text-sm">✓</span>}</button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2"><span className={`text-[15px] ${task.completed ? "text-[#a1a59c] line-through" : "text-[#30352f]"}`}>{task.title}</span>{task.type && <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${categoryStyles[task.type] ?? "bg-[#eef0eb] text-[#657066]"}`}>{task.type}</span>}{task.due_date && <span className={`text-xs ${task.completed ? "text-[#b1b5ae]" : "text-[#858b82]"}`}>Due {formatDueDate(task.due_date)}</span>}</div>
                        {subtasks.length > 0 && <p className="mt-1 text-xs text-[#8b9085]">{subtasks.filter((subtask) => subtask.completed).length}/{subtasks.length} subtasks complete</p>}
                      </div>
                      <button type="button" onClick={() => setExpandedTask(isExpanded ? null : task.id)} className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-[#778076] transition hover:bg-[#eef0eb] hover:text-[#26382c]">{isExpanded ? "Hide" : "+ Subtask"}</button>
                      <button type="button" onClick={() => deleteTask(task)} aria-label={`Delete ${task.title}`} className="shrink-0 rounded-md px-2 py-1 text-lg leading-none text-[#b0b4ac] transition hover:bg-[#f7dfd8] hover:text-[#a45543]">×</button>
                    </div>
                    {isExpanded && <div className="ml-10 mt-3 border-l border-[#dfe2d9] pl-4">{subtasks.map((subtask) => <div key={subtask.id} className="mb-2 flex items-center gap-2 text-sm"><button type="button" onClick={() => toggleTask(subtask)} aria-label={subtask.completed ? `Mark ${subtask.title} as incomplete` : `Mark ${subtask.title} as complete`} className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] transition ${subtask.completed ? "border-[#6d8a72] bg-[#6d8a72] text-white" : "border-[#b8bdb4]"}`}>{subtask.completed && "✓"}</button><span className={subtask.completed ? "text-[#a1a59c] line-through" : "text-[#4e554d]"}>{subtask.title}</span></div>)}<form onSubmit={(event) => addSubtask(event, task.id)} className="mt-3 flex gap-2"><input value={subtaskInputs[String(task.id)] ?? ""} onChange={(event) => setSubtaskInputs((currentInputs) => ({ ...currentInputs, [String(task.id)]: event.target.value }))} placeholder="Add a subtask" aria-label={`Add subtask to ${task.title}`} className="min-w-0 flex-1 rounded-lg border border-[#deded4] bg-[#fafaf7] px-3 py-2 text-xs outline-none placeholder:text-[#a1a59c] focus:border-[#8b9c8d]" /><button type="submit" className="rounded-lg bg-[#eef0eb] px-3 py-2 text-xs font-semibold text-[#4d604f] transition hover:bg-[#e1e7df]">Add</button></form></div>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}