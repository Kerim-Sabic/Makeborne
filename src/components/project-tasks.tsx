"use client";

import { useState } from "react";
import { now, uid, type ProjectTask } from "./studio-model";

export default function ProjectTasks({ tasks, save }: {
  tasks: ProjectTask[];
  save: (tasks: ProjectTask[], activity: string) => boolean;
}) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const today = new Date();
  const localDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const sorted = [...tasks].sort((a, b) => Number(!!a.completedAt) - Number(!!b.completedAt) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.createdAt.localeCompare(b.createdAt));
  function reset() { setTitle(""); setDueDate(""); setEditing(null); setError(""); }
  return <section className="project-tasks" aria-labelledby="project-tasks-title">
    <div className="eyebrow">NEXT STEPS</div>
    <h2 id="project-tasks-title">Keep the work moving.</h2>
    <p className="muted">{tasks.filter(task => !task.completedAt).length} open tasks. Dates are internal targets; no reminders are sent.</p>
    <form onSubmit={event => {
      event.preventDefault();
      if (!title.trim()) return;
      if (!editing && tasks.length >= 300) { setError("This project has reached 300 tasks. Export a workspace backup before continuing."); return; }
      const task = { id: editing ?? uid(), title: title.trim(), dueDate: dueDate || null, completedAt: null, createdAt: now() };
      const next = editing ? tasks.map(item => item.id === editing ? { ...item, title: task.title, dueDate: task.dueDate } : item) : [...tasks, task];
      if (save(next, `${editing ? "Updated" : "Added"} task: ${task.title}`)) reset();
      else setError("The task could not be saved. Your entered details are still here; check the workspace message.");
    }}>
      <label>Task<input value={title} onChange={event => setTitle(event.target.value)} maxLength={300} placeholder="e.g. Review the homepage with the client" required /></label>
      <label>Due date (optional)<input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
      <div className="task-actions"><button className="button secondary" disabled={!title.trim()} type="submit">{editing ? "Save task" : "Add task"}</button>{editing && <button className="button secondary" type="button" onClick={reset}>Cancel edit</button>}</div>
      {error && <p role="alert">{error}</p>}
    </form>
    {sorted.length === 0 ? <p className="muted">Add the next action for this project.</p> : <ul className="project-task-list">
      {sorted.map(task => <li key={task.id}>
        <label className="task-check"><input type="checkbox" checked={!!task.completedAt} onChange={() => {
          if (!save(tasks.map(item => item.id === task.id ? { ...item, completedAt: item.completedAt ? null : now() } : item), `${task.completedAt ? "Reopened" : "Completed"} task: ${task.title}`)) setError("The task status could not be saved. Please check the workspace message.");
          else setError("");
        }} /><span className={task.completedAt ? "task-complete" : ""}>{task.title}</span></label>
        {task.dueDate && <span className={!task.completedAt && task.dueDate < localDay ? "task-overdue" : "muted"}>{!task.completedAt && task.dueDate < localDay ? "Overdue · " : "Due · "}{new Date(`${task.dueDate}T12:00:00`).toLocaleDateString()}</span>}
        <button type="button" className="text-link" aria-label={`Edit task: ${task.title}`} onClick={() => { setEditing(task.id); setTitle(task.title); setDueDate(task.dueDate ?? ""); setError(""); }}>Edit</button>
      </li>)}
    </ul>}
  </section>;
}
