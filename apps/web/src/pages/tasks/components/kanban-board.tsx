import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { ITask } from '@tbot/shared';
import {
  createContext,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { LoadMore } from '@/components/ui/load-more';
import { CardSkeleton } from '@/components/ui/skeleton';
import { haptic, lockVerticalSwipes, unlockVerticalSwipes } from '@/lib/telegram';

/**
 * Mouse/pen drags via PointerSensor; touch is left to TouchSensor (press-and-hold) so a
 * plain swipe on a phone still scrolls the page / board.
 */
class NonTouchPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: ReactPointerEvent) =>
        event.pointerType !== 'touch' && event.isPrimary && event.button === 0,
    },
  ];
}

export interface KanbanColumn {
  id: string;
  title: ReactNode;
  /** Plain-text name for screen readers. */
  label: string;
  /** Total in the column (server count); `null` while unknown. */
  count: number | null;
  tasks: ITask[];
  emptyText?: string;
  /** First page still loading → card skeletons. */
  isLoading?: boolean;
  /** Couldn't load the column. */
  error?: string | null;
  onRetry?: () => void;
  /** More pages on the server → "Load more (N left)" at the bottom. */
  hasMore?: boolean;
  isFetchingMore?: boolean;
  onLoadMore?: () => void;
  /** Auto-load when the column's end scrolls into view (off after a failed load). */
  autoLoad?: boolean;
  /** Column is refetching → hold auto-load until it settles. */
  isRefetching?: boolean;
}

type RenderCard = (task: ITask, options: { isOverlay: boolean }) => ReactNode;

interface BoardContextValue {
  active: { task: ITask; columnId: string } | null;
  renderCard: RenderCard;
}

const BoardContext = createContext<BoardContextValue | null>(null);

interface KanbanBoardProps {
  /** Columns with their data; or render `KanbanColumnView`s (e.g. ones that load their own pages) as children. */
  columns?: KanbanColumn[];
  children?: ReactNode;
  renderCard: RenderCard;
  onMove: (task: ITask, fromColumnId: string, toColumnId: string) => void;
  footer?: ReactNode;
}

export function KanbanBoard({ columns, children, renderCard, onMove, footer }: KanbanBoardProps) {
  const [active, setActive] = useState<{ task: ITask; columnId: string } | null>(null);

  const sensors = useSensors(
    useSensor(NonTouchPointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const handleDragStart = ({ active: a }: DragStartEvent) => {
    const data = a.data.current as { task: ITask; columnId: string } | undefined;
    if (data) {
      setActive(data);
      haptic('light');
      // A vertical drag would otherwise swipe the Mini App closed.
      lockVerticalSwipes();
    }
  };

  const handleDragEnd = ({ active: a, over }: DragEndEvent) => {
    setActive(null);
    unlockVerticalSwipes();
    const data = a.data.current as { task: ITask; columnId: string } | undefined;
    if (!data || !over) return;
    const to = String(over.id);
    if (to !== data.columnId) {
      haptic('light');
      onMove(data.task, data.columnId, to);
    }
  };

  useEffect(() => () => unlockVerticalSwipes(), []);

  const context = useMemo(() => ({ active, renderCard }), [active, renderCard]);

  return (
    <BoardContext.Provider value={context}>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActive(null);
          unlockVerticalSwipes();
        }}
      >
        <div className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-px-4 px-4 pb-4 pt-2 md:snap-none">
          {columns?.map((column) => (
            <KanbanColumnView key={column.id} column={column} />
          ))}
          {children}
        </div>
        {footer}
        <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
          {active ? (
            <div className="w-[min(78vw,300px)] cursor-grabbing">{renderCard(active.task, { isOverlay: true })}</div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </BoardContext.Provider>
  );
}

/** One droppable column; must be rendered inside a KanbanBoard. */
export function KanbanColumnView({ column }: { column: KanbanColumn }) {
  const board = useContext(BoardContext);
  if (!board) throw new Error('KanbanColumnView must be rendered inside KanbanBoard');
  const { active, renderCard } = board;
  const isDragging = !!active;
  const isSource = active?.columnId === column.id;
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const highlight = isOver && !isSource;
  const dropTarget = isDragging && !isSource;

  return (
    <section
      ref={setNodeRef}
      aria-label={column.label}
      className={`flex w-[80vw] max-w-[320px] shrink-0 snap-start flex-col rounded-lg bg-tg-secondary transition-[box-shadow,background-color] md:w-auto md:min-w-[240px] md:max-w-none md:flex-1 md:shrink ${
        highlight ? 'tint-selected ring-2 ring-tg-link' : dropTarget ? 'ring-1 ring-tg-link/40' : ''
      }`}
    >
      <header className="flex min-h-10 items-center gap-2 px-3 pb-1.5 pt-2.5">
        <h2 className="flex min-w-0 items-center gap-2 truncate text-xs font-semibold uppercase tracking-wide text-tg-hint">
          {column.title}
        </h2>
        <span
          className="min-w-5 rounded-full bg-tg-bg px-1.5 text-center text-[11px] font-semibold leading-5 text-tg-hint"
          aria-label={column.count === null ? 'Counting tasks' : `${column.count} task${column.count === 1 ? '' : 's'}`}
        >
          {column.count ?? '…'}
        </span>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-1.5 px-1.5 pb-1.5">
        {column.isLoading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : column.error && column.tasks.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-tg-separator px-2 py-4 text-center text-xs text-tg-hint">
            <span>Couldn't load this column.</span>
            {column.onRetry && (
              <button
                type="button"
                onClick={column.onRetry}
                className="focus-ring min-h-11 rounded-md px-3 text-sm font-medium text-tg-link transition-colors hover:bg-tg-bg/60 active:bg-tg-bg/60"
              >
                Retry
              </button>
            )}
          </div>
        ) : column.tasks.length === 0 && !column.hasMore ? (
          <p
            className={`flex flex-1 items-center justify-center rounded-md border border-dashed px-2 py-6 text-center text-xs text-tg-hint transition-colors ${
              dropTarget ? 'border-tg-link/60 text-tg-link' : 'border-tg-separator'
            }`}
          >
            {dropTarget ? 'Drop here' : (column.emptyText ?? 'No tasks')}
          </p>
        ) : (
          <>
            {column.tasks.map((task) => (
              <DraggableCard key={task._id} task={task} columnId={column.id}>
                {renderCard(task, { isOverlay: false })}
              </DraggableCard>
            ))}
            {column.hasMore && column.onLoadMore && (
              <LoadMore
                onLoadMore={column.onLoadMore}
                isLoading={!!column.isFetchingMore}
                auto={column.autoLoad ?? true}
                paused={column.isRefetching}
                remaining={column.count !== null ? column.count - column.tasks.length : undefined}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}

function DraggableCard({ task, columnId, children }: { task: ITask; columnId: string; children: ReactNode }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: task._id,
    data: { task, columnId },
  });
  // Keyboard users open the card with Enter and move it from its ⋯ menu, so drop the
  // sensor's keyboard semantics (role="button" etc. are on the card itself).
  const { role: _role, tabIndex: _tabIndex, ...restAttributes } = attributes;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...restAttributes}
      className={`touch-manipulation ${isDragging ? 'opacity-40' : ''}`}
    >
      {children}
    </div>
  );
}
