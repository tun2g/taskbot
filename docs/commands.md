# Bot commands

Send `/help` in any chat for the interactive guide.

## Creating tasks

| Command | What it does |
|---------|--------------|
| `/new <text>` | AI turns your text into one or more tasks (type, assignee, due date), e.g. `/new Fix login on iOS @an` |
| reply `/new` | Create tasks from the replied-to message. `/new <note>` adds your note as a hint |
| reply `/new all` | Create tasks from that message through the latest one |
| `/new 10` | Create tasks from the last 10 messages (max 50) |
| `/sub 12 <text>` | Add a subtask to #12, or reply `/sub <text>` to its card. One per line for several |

The AI can split one message into several tasks. Created something by mistake? Tap ↩️ **Undo** within 10 minutes.
`/new 10` and `/new all` need group privacy mode disabled in BotFather (see [Configuration](configuration.md#botfather-setup)).

## Changing tasks

| Command | What it does |
|---------|--------------|
| Card buttons | Next step, 👤 Assign, ⋯ More (status, type, priority, delete) |
| `/update #12 <plain words>` | Change one task with AI, description included. Or reply `/update …` to its card |
| `/done #12` | Finish a task, or reply `/done` to its card |
| `/ai <plain words>` | Ask anything in plain language (see below) |

## Finding tasks

| Command | What it does |
|---------|--------------|
| `/list` | Open tasks. Add filters such as `open`, `review`, `pending`, `bug`, `@name` |
| `/mytasks` | Tasks assigned to you |

## Group and account

| Command | What it does |
|---------|--------------|
| `/start` | In a private chat: pick a group board |
| `/members` | Lets people tap ✋ to register as assignees (Telegram doesn't let bots list members) |
| `/settopic` | In forum groups: send task events to the current topic |
| `/mcp` | Get a token to connect Claude Code / Cursor (see [mcp.md](mcp.md)) |
| `/help` | Interactive guide |

**Hidden aliases:** `/task` and `/create` → `/new`, `/tasks` → `/list`, `/subtask` → `/sub`.

## `/ai` examples

The assistant understands Vietnamese and English and replies in the language you use.

```text
(reply to a task card) /ai assign this to @an
/ai #12 is done
/ai move #12 to review, priority high
/ai what tasks do I still have?
/ai explain #5
/ai add #5 to the Login epic
/ai split #5 into subtasks
/ai create a task to fix login for @an, due Friday
```

## Task model

- **Statuses:** Backlog · To do · In progress · In review · Pending · Done · Cancelled
- **Types:** Bug · Feature · Improvement · Task · Chore · Research · Question
- **Priorities:** Low · Medium · High · Urgent
- **Epics** group related tasks and track their progress. **Subtasks** hang off a parent task.

## Notifications

- DM when you're assigned or your task changes status
- DM reminder the day before a task is due (sent from 9:00 group time)
- Daily summary in the group at 9:00 group time

To receive DMs, open a private chat with the bot once and tap **Start**.
