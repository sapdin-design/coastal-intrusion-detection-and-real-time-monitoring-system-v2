import type { RouteScenario } from './maritime';

/**
 * Simulation scenarios.
 *
 * A scenario is a *staging rule*, not a script: it decides which contacts are
 * under way, which sea lanes they may be assigned, and it publishes the narrative
 * stages an operator should watch for. It never fabricates an outcome — the
 * geofencing engine still has to see a real polygon crossing before an intrusion
 * is raised. The simulator only sets the stage; the detection pipeline does the
 * detecting.
 *
 * Default is `MULTI_VESSEL`, which is exactly the behaviour the engine had before
 * scenarios existed, so nothing regresses for existing callers.
 */
export const SIMULATION_SCENARIOS = [
  'NORMAL_PATROL',
  'ZONE_APPROACH',
  'INTRUSION_DEMO',
  'MULTI_VESSEL',
  'FULL_DEMO',
] as const;

export type SimulationScenario = (typeof SIMULATION_SCENARIOS)[number];

export const DEFAULT_SCENARIO: SimulationScenario = 'MULTI_VESSEL';

/**
 * Which contacts the scenario puts under way.
 *
 * - `leadVesselCode`   – the named contact that carries the scenario's story.
 * - `leadRouteId`      – force a specific sea lane for the lead contact.
 * - `background`       – how many other contacts keep station as traffic.
 * - `all`              – every simulated contact is under way.
 *
 * Contacts that are not selected are held at their berth: they stay on the plot
 * with a fresh last-seen stamp but do not move, so a focused demo is not polluted
 * by twenty unrelated tracks — and no spurious "offline" alert is raised.
 */
export interface ParticipantRule {
  leadVesselCode?: string;
  /** When no code is named, the first unauthorized contact leads. */
  leadPrefersUnauthorized: boolean;
  leadRouteScenarios: RouteScenario[];
  /** Forces one exact lane for the lead, when the scenario names one. */
  leadRouteId?: string;
  backgroundRouteScenarios: RouteScenario[];
  background: number;
  all?: boolean;
}

/** One narrative beat on the simulator timeline. */
export interface TimelineStage {
  key: string;
  label: string;
  detail: string;
}

export interface ScenarioDefinition {
  id: SimulationScenario;
  name: string;
  summary: string;
  participants: ParticipantRule;
  timeline: TimelineStage[];
}

const OPEN_SEA: TimelineStage = {
  key: 'OPEN_SEA',
  label: 'Open sea',
  detail: 'Contact under way in open water, clear of every restricted area.',
};

const NORMAL: TimelineStage = {
  key: 'NORMAL',
  label: 'Normal',
  detail: 'Track steady on its lane. Geofencing engine reports no zone activity.',
};

const APPROACHING: TimelineStage = {
  key: 'APPROACHING',
  label: 'Approaching',
  detail: 'Contact is inside the warning buffer and closing on the zone boundary.',
};

const BOUNDARY: TimelineStage = {
  key: 'BOUNDARY',
  label: 'Restricted zone',
  detail: 'Contact has reached the offshore restricted-zone boundary.',
};

const INTRUSION: TimelineStage = {
  key: 'INTRUSION',
  label: 'Intrusion',
  detail: 'Contact crossed the polygon without authorization.',
};

const ALERT: TimelineStage = {
  key: 'ALERT',
  label: 'Critical alert',
  detail: 'Intrusion alert raised and broadcast to the operations room.',
};

const INCIDENT: TimelineStage = {
  key: 'INCIDENT',
  label: 'Incident created',
  detail: 'Incident file opened with the full track history attached.',
};

export const SCENARIO_DEFINITIONS: Record<SimulationScenario, ScenarioDefinition> = {
  NORMAL_PATROL: {
    id: 'NORMAL_PATROL',
    name: 'Normal Patrol',
    summary:
      'Routine offshore patrol. Authorized units only, no restricted-area activity. The baseline picture.',
    participants: {
      leadPrefersUnauthorized: false,
      leadRouteScenarios: ['PATROL'],
      backgroundRouteScenarios: ['PATROL', 'TRANSIT'],
      background: 5,
    },
    timeline: [
      OPEN_SEA,
      NORMAL,
      {
        key: 'PATROL_LOOP',
        label: 'Patrol box held',
        detail: 'Units looping their assigned boxes, standing off the shore.',
      },
    ],
  },

  ZONE_APPROACH: {
    id: 'ZONE_APPROACH',
    name: 'Zone Approach',
    summary:
      'An unauthorized contact closes on a restricted zone, holds outside the boundary, then withdraws. It never enters.',
    participants: {
      leadPrefersUnauthorized: true,
      leadRouteScenarios: ['APPROACH'],
      leadRouteId: 'APPROACH-CAPE',
      backgroundRouteScenarios: ['PATROL'],
      background: 2,
    },
    timeline: [
      OPEN_SEA,
      NORMAL,
      APPROACHING,
      {
        key: 'HOLDING',
        label: 'Holding outside',
        detail: 'Contact holds station just outside the boundary. No entry — no intrusion.',
      },
      {
        key: 'WITHDRAWAL',
        label: 'Withdrawal',
        detail: 'Contact turns away and clears the warning buffer.',
      },
    ],
  },

  INTRUSION_DEMO: {
    id: 'INTRUSION_DEMO',
    name: 'Intrusion Demo',
    summary:
      'The full pipeline, start to finish. An unauthorized fishing boat runs the cape exclusion lane and physically crosses the offshore boundary.',
    participants: {
      leadVesselCode: 'V005',
      leadPrefersUnauthorized: true,
      leadRouteScenarios: ['INTRUSION'],
      leadRouteId: 'INTRUSION-CAPE',
      backgroundRouteScenarios: ['PATROL'],
      background: 2,
    },
    timeline: [OPEN_SEA, NORMAL, APPROACHING, BOUNDARY, INTRUSION, ALERT, INCIDENT],
  },

  MULTI_VESSEL: {
    id: 'MULTI_VESSEL',
    name: 'Multiple Vessel',
    summary:
      'The full traffic picture — patrols, coastal transits and unauthorized contacts converging on separate zones at once.',
    participants: {
      leadPrefersUnauthorized: false,
      leadRouteScenarios: ['PATROL', 'TRANSIT'],
      backgroundRouteScenarios: ['PATROL', 'TRANSIT', 'APPROACH', 'INTRUSION', 'WITHDRAWAL'],
      background: 0,
      all: true,
    },
    timeline: [
      OPEN_SEA,
      NORMAL,
      {
        key: 'MULTIPLE_CONTACTS',
        label: 'Multiple contacts',
        detail: 'All simulated contacts under way across the sector.',
      },
      {
        key: 'CONVERGING',
        label: 'Converging',
        detail: 'Unauthorized contacts closing on their target zones.',
      },
      INTRUSION,
    ],
  },

  FULL_DEMO: {
    id: 'FULL_DEMO',
    name: 'Emergency / Full Demo',
    summary:
      'Everything at once: every contact under way, multiple intrusions, dark contacts dropping off the plot and loitering detections.',
    participants: {
      // The lead has to be an unauthorized contact — an authorized unit on an
      // intrusion lane would log an AUTHORIZED_ENTRY, not an intrusion.
      leadPrefersUnauthorized: true,
      leadRouteScenarios: ['INTRUSION'],
      backgroundRouteScenarios: ['PATROL', 'TRANSIT', 'APPROACH', 'INTRUSION', 'WITHDRAWAL'],
      background: 0,
      all: true,
    },
    timeline: [
      OPEN_SEA,
      NORMAL,
      APPROACHING,
      INTRUSION,
      ALERT,
      {
        key: 'OFFLINE',
        label: 'Contact lost',
        detail: 'Dark contacts stop reporting and are flagged offline.',
      },
      INCIDENT,
    ],
  },
};

export const SCENARIO_LIST: ScenarioDefinition[] = SIMULATION_SCENARIOS.map(
  (id) => SCENARIO_DEFINITIONS[id],
);

export const scenarioById = (id: string): ScenarioDefinition | undefined =>
  SCENARIO_DEFINITIONS[id as SimulationScenario];

export const isScenario = (id: string): id is SimulationScenario =>
  (SIMULATION_SCENARIOS as readonly string[]).includes(id);
