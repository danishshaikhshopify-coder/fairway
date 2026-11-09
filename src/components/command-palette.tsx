"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ListTodo, Target, Users } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useCrm } from "@/lib/crm-store";
import { NAV_GROUPS } from "@/lib/nav";

const MAX_RESULTS = 5;

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { leads, contacts, companies } = useCrm();
  const [query, setQuery] = useState("");

  function go(href: string) {
    onOpenChange(false);
    setQuery("");
    router.push(href);
  }

  const q = query.trim().toLowerCase();

  const pageMatches = useMemo(
    () =>
      NAV_GROUPS.flatMap((group) => group.items).filter((item) =>
        q ? item.label.toLowerCase().includes(q) : true,
      ),
    [q],
  );

  const leadMatches = useMemo(
    () =>
      q
        ? leads
            .filter(
              (l) =>
                l.company.toLowerCase().includes(q) ||
                l.contact.toLowerCase().includes(q),
            )
            .slice(0, MAX_RESULTS)
        : [],
    [leads, q],
  );

  const contactMatches = useMemo(
    () =>
      q
        ? contacts.filter((c) => c.name.toLowerCase().includes(q)).slice(0, MAX_RESULTS)
        : [],
    [contacts, q],
  );

  const companyMatches = useMemo(
    () =>
      q
        ? companies.filter((c) => c.name.toLowerCase().includes(q)).slice(0, MAX_RESULTS)
        : [],
    [companies, q],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="glass-panel top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden rounded-2xl border p-0 shadow-2xl sm:max-w-xl"
      >
        <Command shouldFilter={false} loop>
          <CommandInput
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder="Search leads, contacts, companies or jump to a page…"
          />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>

            {!q ? (
              <CommandGroup heading="Quick create">
                <CommandItem onSelect={() => go("/leads?new=1")}>
                  <Target aria-hidden="true" />
                  New lead
                </CommandItem>
                <CommandItem onSelect={() => go("/contacts?new=1")}>
                  <Users aria-hidden="true" />
                  New contact
                </CommandItem>
                <CommandItem onSelect={() => go("/companies?new=1")}>
                  <Building2 aria-hidden="true" />
                  New company
                </CommandItem>
                <CommandItem onSelect={() => go("/tasks?new=1")}>
                  <ListTodo aria-hidden="true" />
                  New task
                </CommandItem>
              </CommandGroup>
            ) : null}

            {pageMatches.length > 0 ? (
              <CommandGroup heading="Pages">
                {pageMatches.map((item) => (
                  <CommandItem key={item.href} value={item.href} onSelect={() => go(item.href)}>
                    <item.icon aria-hidden="true" />
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {leadMatches.length > 0 ? (
              <CommandGroup heading="Leads">
                {leadMatches.map((lead) => (
                  <CommandItem
                    key={lead.id}
                    value={`lead-${lead.id}`}
                    onSelect={() => go(`/leads?lead=${lead.id}`)}
                  >
                    <Target aria-hidden="true" />
                    <span className="truncate">{lead.company}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {lead.contact}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {contactMatches.length > 0 ? (
              <CommandGroup heading="Contacts">
                {contactMatches.map((contact) => (
                  <CommandItem
                    key={contact.id}
                    value={`contact-${contact.id}`}
                    onSelect={() => go(`/contacts?contact=${contact.id}`)}
                  >
                    <Users aria-hidden="true" />
                    <span className="truncate">{contact.name}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {contact.company}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {companyMatches.length > 0 ? (
              <CommandGroup heading="Companies">
                {companyMatches.map((company) => (
                  <CommandItem
                    key={company.id}
                    value={`company-${company.id}`}
                    onSelect={() => go(`/companies?company=${company.id}`)}
                  >
                    <Building2 aria-hidden="true" />
                    <span className="truncate">{company.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
