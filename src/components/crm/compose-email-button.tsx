"use client";

// A small "Send email" action for a lead/contact detail view. Sends through
// the signed-in member's own connected Gmail (POST /api/integrations/gmail/
// send) and logs the result as an outbound activity linked back to whatever
// id was passed in — see that route for the activity-logging side.

import { useState } from "react";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/crm/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ComposeEmailButton({
  to,
  leadId,
  contactId,
  companyId,
}: {
  to: string;
  leadId?: string | null;
  contactId?: string | null;
  companyId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      const response = await fetch("/api/integrations/gmail/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, subject, body, leadId, contactId, companyId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result?.message || result?.error || "Could not send the email.");
      }
      toast.success(`Email sent to ${to}.`);
      setOpen(false);
      setSubject("");
      setBody("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the email.");
    } finally {
      setSending(false);
    }
  }

  if (!to) return null;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Mail className="size-4" aria-hidden="true" />
        Send email
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send email</DialogTitle>
            <DialogDescription>
              Sent from your connected Gmail account to {to}, and logged as an activity.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <FormField label="Subject" required>
              {(props) => <Input {...props} value={subject} onChange={(e) => setSubject(e.target.value)} />}
            </FormField>
            <FormField label="Message" required>
              {(props) => (
                <Textarea {...props} rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
              )}
            </FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={send} disabled={sending || !subject.trim() || !body.trim()}>
              {sending ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
