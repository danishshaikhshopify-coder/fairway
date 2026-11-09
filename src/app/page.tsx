"use client";

import Link from "next/link";
import { useMemo } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  CircleCheck,
  ListTodo,
  PhoneCall,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ActivityTypeBadge } from "@/components/crm/status-badge";
import { AnimatedNumber } from "@/components/crm/animated-number";
import { HorizontalBarChart } from "@/components/crm/charts/horizontal-bar-chart";
import { EmptyState } from "@/components/crm/empty-state";
import { KpiCard } from "@/components/crm/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { useCrm } from "@/lib/crm-store";
import { fadeUp, staggerList } from "@/lib/motion";
import { useToday } from "@/lib/use-today";
import { cn } from "@/lib/utils";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  isOverdue,
} from "@/lib/format";
import { PIPELINE_LABELS, PIPELINE_STAGES } from "@/lib/types";

const ACTIVE_STATUSES = new Set(["new", "contacted", "qualified", "proposal"]);

export default function DashboardPage() {
  const { leads, tasks, activities } = useCrm();
  const today = useToday();

  const stats = useMemo(() => {
    const active = leads.filter((l) => ACTIVE_STATUSES.has(l.status));
    const won = leads.filter((l) => l.status === "won");
    const qualified = leads.filter(
      (l) => l.status === "qualified" || l.status === "proposal",
    );
    const overdueLeads = active.filter(
      (l) => l.nextFollowUp && isOverdue(l.nextFollowUp, today),
    );
    return {
      total: leads.length,
      activeCount: active.length,
      wonCount: won.length,
      qualifiedCount: qualified.length,
      pipelineValue: active.reduce((sum, l) => sum + l.value, 0),
      overdueCount: overdueLeads.length,
    };
  }, [leads, today]);

  // One prioritized list: overdue lead follow-ups and overdue tasks, soonest first.
  const attention = useMemo(() => {
    type Item = {
      key: string;
      icon: typeof PhoneCall;
      title: string;
      meta: string;
      sortDate: string;
      href: string;
    };
    const leadItems: Item[] = leads
      .filter(
        (l) =>
          ACTIVE_STATUSES.has(l.status) &&
          l.nextFollowUp &&
          isOverdue(l.nextFollowUp, today),
      )
      .map((l) => ({
        key: `lead-${l.id}`,
        icon: PhoneCall,
        title: l.company,
        meta: `${l.contact} · follow-up was due ${formatDate(l.nextFollowUp)}`,
        sortDate: l.nextFollowUp,
        href: `/leads?lead=${l.id}`,
      }));
    const taskItems: Item[] = tasks
      .filter((t) => !t.done && isOverdue(t.dueDate, today))
      .map((t) => ({
        key: `task-${t.id}`,
        icon: ListTodo,
        title: t.title,
        meta: `${t.relatedTo} · due ${formatDate(t.dueDate)}`,
        sortDate: t.dueDate,
        href: "/tasks",
      }));
    // Full list first so the badge can show the true count; the card shows 7.
    return [...leadItems, ...taskItems].sort((a, b) =>
      a.sortDate.localeCompare(b.sortDate),
    );
  }, [leads, tasks, today]);

  const attentionTotal = attention.length;
  const attentionShown = attention.slice(0, 7);

  const pipelineSummary = useMemo(() => {
    return PIPELINE_STAGES.map((stage) => {
      const stageLeads = leads.filter((l) => l.status === stage);
      return {
        stage,
        count: stageLeads.length,
        value: stageLeads.reduce((sum, l) => sum + l.value, 0),
      };
    });
  }, [leads]);

  const recentActivities = useMemo(() => {
    return [...activities]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
  }, [activities]);

  const stageChartData = useMemo(
    () =>
      pipelineSummary.map((row) => ({
        key: row.stage,
        label: PIPELINE_LABELS[row.stage],
        value: row.value,
        count: row.count,
      })),
    [pipelineSummary],
  );

  return (
    <motion.div
      className="space-y-4 sm:space-y-6"
      variants={staggerList}
      initial="hidden"
      animate="show"
    >
      <PageHeader title="Dashboard" />

      <motion.div
        className="grid grid-cols-2 gap-3 xl:grid-cols-4"
        variants={staggerList}
      >
        <motion.div variants={fadeUp}>
          <KpiCard
            label="Total leads"
            value={<AnimatedNumber value={stats.total} />}
            hint={`${stats.activeCount} active · ${stats.wonCount} won`}
            icon={Users}
          />
        </motion.div>
        <motion.div variants={fadeUp}>
          <KpiCard
            label="Qualified"
            value={<AnimatedNumber value={stats.qualifiedCount} />}
            hint="Qualified or proposal"
            icon={Target}
          />
        </motion.div>
        <motion.div variants={fadeUp}>
          <KpiCard
            label="Open opportunities"
            value={<AnimatedNumber value={stats.activeCount} />}
            hint={`${formatCurrency(stats.pipelineValue)} in pipeline`}
            icon={TrendingUp}
          />
        </motion.div>
        <motion.div variants={fadeUp}>
          <KpiCard
            label="Overdue follow-ups"
            value={<AnimatedNumber value={stats.overdueCount} />}
            hint={
              stats.overdueCount > 0
                ? "Needs attention today"
                : "All on schedule"
            }
            icon={PhoneCall}
            tone={stats.overdueCount > 0 ? "warning" : "success"}
          />
        </motion.div>
      </motion.div>

      <motion.div className="grid gap-4 lg:grid-cols-5" variants={fadeUp}>
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Needs attention
              {attentionTotal > 0 ? (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive tabular-nums">
                  {attentionTotal}
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {attentionShown.length === 0 ? (
              <div className="flex items-center gap-3 py-2 text-sm text-muted-foreground">
                <CircleCheck className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                All caught up — no overdue follow-ups or tasks.
              </div>
            ) : (
              <ul className="-mx-1">
                {attentionShown.map((item) => (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      className="group flex items-center gap-3 rounded-lg px-1 py-2.5 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                        <item.icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {item.title}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {item.meta}
                        </span>
                      </span>
                      <ArrowRight
                        className="size-4 shrink-0 text-muted-foreground transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-foreground"
                        aria-hidden="true"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardAction>
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link href="/activities" />}
              >
                View all
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {recentActivities.length === 0 ? (
              <EmptyState
                title="No activity yet"
                description="Log calls, emails and meetings on the Activities page."
              />
            ) : (
              <ul className="-mx-1">
                {recentActivities.map((activity) => (
                  <li
                    key={activity.id}
                    className="flex items-start justify-between gap-3 rounded-lg px-1 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {activity.subject}
                      </span>
                      <span
                        className={cn(
                          "block text-xs text-muted-foreground",
                        )}
                      >
                        {activity.relatedTo} · {formatDateTime(activity.date)}
                      </span>
                    </span>
                    <ActivityTypeBadge type={activity.type} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Card>
          <CardHeader>
            <CardTitle>Pipeline by stage</CardTitle>
            <CardAction>
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={<Link href="/pipeline" />}
              >
                Open board
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <HorizontalBarChart
              data={stageChartData}
              valueFormatter={formatCurrency}
              tooltipExtra={(row) =>
                `${row.count} lead${row.count === 1 ? "" : "s"}`
              }
            />
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
