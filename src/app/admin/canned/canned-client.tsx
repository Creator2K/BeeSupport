"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CannedDeleteDialog } from "./canned-delete-dialog";
import { CannedFormDialog } from "./canned-form-dialog";
import { CannedListTable } from "./canned-list-table";
import type { CannedRecord, CannedSiteOption } from "./canned-types";

export type { CannedRecord, CannedSiteOption } from "./canned-types";

export function CannedClient({
  items,
  sites,
  categories,
  total,
}: {
  categories: string[];
  total: number;
  items: CannedRecord[];
  sites: CannedSiteOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<CannedRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<CannedRecord | null>(null);

  return (
    <div className="space-y-4">
      <CannedListTable
        items={items}
        total={total}
        onCreate={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        onEdit={(item) => {
          setEditing(item);
          setFormOpen(true);
        }}
        onDelete={setDeleting}
      />

      <CannedFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        item={editing}
        sites={sites}
        categories={categories}
        onSaved={() => router.refresh()}
      />

      {deleting && (
        <CannedDeleteDialog
          key={deleting.id}
          item={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
