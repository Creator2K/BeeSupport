"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AgentDeleteDialog } from "./agent-delete-dialog";
import { AgentFormDialog } from "./agent-form-dialog";
import { AgentResetPasswordDialog } from "./agent-reset-password-dialog";
import { AgentTable } from "./agent-table";
import type { AgentRecord, AgentSiteOption } from "./agent-types";

export type { AgentRecord, AgentSiteOption } from "./agent-types";

export function AgentsClient({
  agents,
  sites,
}: {
  agents: AgentRecord[];
  sites: AgentSiteOption[];
}) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AgentRecord | null>(null);
  const [deleting, setDeleting] = useState<AgentRecord | null>(null);
  const [resetting, setResetting] = useState<AgentRecord | null>(null);

  return (
    <div className="space-y-4">
      <AgentTable
        agents={agents}
        sites={sites}
        onCreate={() => {
          setEditing(null);
          setFormOpen(true);
        }}
        onEdit={(agent) => {
          setEditing(agent);
          setFormOpen(true);
        }}
        onReset={setResetting}
        onDelete={setDeleting}
      />

      <AgentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        agent={editing}
        sites={sites}
        onSaved={() => router.refresh()}
      />

      <AgentResetPasswordDialog
        agent={resetting}
        onClose={() => setResetting(null)}
        onDone={() => {
          setResetting(null);
          router.refresh();
        }}
      />

      {deleting && (
        <AgentDeleteDialog
          key={deleting.id}
          agent={deleting}
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
