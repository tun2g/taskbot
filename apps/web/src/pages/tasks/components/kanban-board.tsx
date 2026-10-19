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
import { type PointerEvent as ReactPointerEvent, type ReactNode, useState } from 'react';

import { haptic } from '@/lib/telegram';

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
  count: number;
  tasks: ITask[];
  emptyText?: string;
}

interface KanbanBoardProps {
  columns: KanbanColumn[];
  renderCard: (task: ITask, options: { isOverlay: boolean }) => ReactNode;
  onMove: (task: ITask, fromColumnId: string, toColumnId: string) => void;
  footer?: ReactNode;
}

export function KanbanBoard({ columns, renderCard, onMove, footer }: KanbanBoardProps) {
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
    }
  };

  const handleDragEnd = ({ active: a, over }: DragEndEvent) => {
    setActive(null);
    const data = a.data.current as { task: ITask; columnId: string } | undefined;
    if (!data || !over) return;
    const to = String(over.id);
    if (to !== data.columnId) {
      haptic('light');
      onMove(data.task, data.columnId, to);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActive(null)}
    >
      <div className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-px-4 px-4 pb-4 pt-2 md:snap-none">
        {columns.map((column) => (
          <Column key={column.id} column={column} isDragging={!!active} isSource={active?.columnId === column.id}>
            {column.tasks.map((task) => (
              <DraggableCard key={task._id} task={task} columnId={column.id}>
                {renderCard(task, { isOverlay: false })}
              </DraggableCard>
            ))}
          </Column>
        ))}
      </div>
      {footer}
      <DragOverlay dropAnimation={{ duration: 180, easing: 'ease-out' }}>
        {active ? <div className="w-[min(78vw,300px)] cursor-grabbing">{renderCard(active.task, { isOverlay: true })}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  column,
  isDragging,
  isSource,
  children,
}: {
  column: KanbanColumn;
  isDragging: boolean;
  isSource: boolean;
  children: ReactNode;
}) {
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
      <header className="flex min-h-10 items-center gap-2 px-3 pb-1 pt-2.5">
        <h2 className="flex min-w-0 items-center gap-2 truncate text-xs font-semibold uppercase tracking-wide text-tg-hint">
          {column.title}
        </h2>
        <span className="text-xs font-semibold text-tg-hint">{column.count}</span>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-1.5 px-1.5 pb-1.5">
        {column.tasks.length === 0 ? (
          <p
            className={`flex flex-1 items-center justify-center rounded-md px-2 py-6 text-center text-xs text-tg-hint ${
              dropTarget ? 'border border-dashed border-tg-link/60' : ''
            }`}
          >
            {dropTarget ? 'Drop here' : (column.emptyText ?? 'No tasks')}
          </p>
        ) : (
          children
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
