# Worklands playtest

Game is a spatial control surface for real Agents Window sessions, not a simulated progress dashboard.

1. **Choose Workspace** in the command dock and select an available provider.
2. **New Task** creates a movable task site with a name and instructions.
3. **Spawn Blob** creates a free local recruit. It is labeled **Draft - No Session** until dispatched.
4. Drag the recruit into a task's highlighted zone, or select it and use **Assign Task**. Dropping outside all task zones unassigns it. Moving a task carries its assigned crew; moving a parent carries its local child formation.
5. Review **Task Brief Sent with Orders**, add instructions, then **Dispatch**. A new recruit creates a real session. An existing unit sends to its own chat. The map remains open.
6. **Bring Session** places an existing session on the map. **Spawn Child** prepares an additional chat when that provider supports it. Provider-created visible chats and child sessions appear as linked satellites; hidden chats stay hidden and read-only workers cannot be dispatched.
7. **Open Chat** returns to the standard conversation for results, approvals, cancellation, and detailed controls.

Solid gold lines mean task assignment. Dotted purple lines mean parent/child relationships. Labels, changed-file counts, and activity come from live provider state. **Turn complete** does not mean the task was verified or finished.

## Safety and persistence

Spawning, moving, assigning, opening, and reloading never dispatch work. Dispatch uses the selected provider's existing model and approval defaults; no permission elevation is applied. Busy and approval-blocked units must be handled in their normal chat. Errors preserve unsent orders for explicit retry.

The workspace-local board stores task briefs, unsent orders, positions, and session/chat URI links. It does not sync, execute on restoration, delete sessions, or cancel requests when pieces are removed. Missing sessions remain unavailable rather than silently becoming new sessions.

## Keyboard and accessibility

Tab reaches map pieces and dock commands; Enter selects a piece. Arrow keys move a focused piece. **Assign Task** replaces dragging. Escape cancels a drag. Accessibility Help describes the controls, and Accessible View lists tasks, assignments, parent links, and live status. Reduced motion and high-contrast themes are supported.

The first playtest intentionally omits combat, pathfinding, resource economies, and automatic delegation. It uses original CSS artwork and existing VS Code icons.
