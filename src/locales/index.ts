import decisionUi from './decision-ui';
import workNavigation from './work-navigation';
import talent from './talent';
import personProfiles from './person-profiles';
import positionDrivers from './position-drivers';
import movementPerspective from './movement-perspective';
import relationshipView from './relationship-view';
import common from './common';
import records from './records';
import work from './work';
import domain from './domain';
import extra from './extra';
import exploration from './exploration';
import identities from './identities';
import roadmap from './roadmap';
import connectivity from './connectivity';
import connectors from './connectors';
export type Message = readonly [english: string, chinese: string, korean: string];
export const messages: readonly Message[] = [
  ...common,
  ...records,
  ...work,
  ...domain,
  ...extra,
  ...exploration,
  ...identities,
  ...roadmap,
  ...connectivity,
  ...connectors,
  ...talent,
  ...movementPerspective,
  ...relationshipView,
  ...decisionUi,
  ...workNavigation,
  ...personProfiles,
  ...positionDrivers,
];
