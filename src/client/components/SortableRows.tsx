// Rows you reorder by dragging their grip (a job's stories and questions). The other rows slide
// out of the way as you drag, a dashed card holds the place the row will land in, and the row
// itself follows the pointer. Dropping slides it into place; the new order is saved.
import { useState, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Icon } from './Icon';
import { cx } from './ui';

/** Up and down only. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** What a row gets to draw itself: its grip (the drag handle) to put where it goes. */
export type RowGrip = ReactNode;

function Row({ id, children }: { id: string; children: (grip: RowGrip) => ReactNode }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const grip = (
    <span
      ref={setActivatorNodeRef}
      className="drag-grip"
      aria-label="Drag to move"
      {...attributes}
      {...listeners}
    >
      <Icon name="grip" size={16} />
    </span>
  );
  return (
    <div
      ref={setNodeRef}
      className={cx('sort-row', isDragging && 'sort-ghost')}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {children(grip)}
    </div>
  );
}

export function SortableRows<T extends { id: string }>({
  items,
  onReorder,
  children,
}: {
  items: T[];
  /** The new order (saved by the caller); the list shows it straight away. */
  onReorder: (next: T[]) => void;
  children: (item: T, grip: RowGrip) => ReactNode;
}) {
  const [active, setActive] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    // Phones: a short press on the grip picks the row up.
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const end = (e: DragEndEvent) => {
    setActive(null);
    const from = items.findIndex((x) => x.id === e.active.id);
    const to = items.findIndex((x) => x.id === e.over?.id);
    if (from >= 0 && to >= 0 && from !== to) onReorder(arrayMove(items, from, to));
  };
  const dragged = items.find((x) => x.id === active);
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={(e) => setActive(String(e.active.id))}
      onDragCancel={() => setActive(null)}
      onDragEnd={end}
    >
      <SortableContext items={items.map((x) => x.id)} strategy={verticalListSortingStrategy}>
        {items.map((item) => (
          <Row key={item.id} id={item.id}>
            {(grip) => children(item, grip)}
          </Row>
        ))}
      </SortableContext>
      {/* The row being dragged, following the pointer; it slides into its place on drop. */}
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
        {dragged ? (
          <div className="sort-row sort-lifted">
            {children(
              dragged,
              <span className="drag-grip">
                <Icon name="grip" size={16} />
              </span>,
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
