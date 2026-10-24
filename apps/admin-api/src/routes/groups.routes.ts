import { Router } from 'express';
import { actionsRouter } from 'src/routes/groups/actions.route';
import { detailRouter } from 'src/routes/groups/detail.route';
import { listRouter } from 'src/routes/groups/list.route';
import { membersRouter } from 'src/routes/groups/members.route';
import { tasksRouter } from 'src/routes/groups/tasks.route';

/**
 * /api/groups — list, detail (+ delete), lifecycle actions and AI overrides, and the paged lists behind the detail
 * page's numbers (people, tasks, epics). Each part lives in src/routes/groups/ as a thin route + a query module.
 */
export const groupsRouter: Router = Router();

groupsRouter.use(listRouter);
groupsRouter.use(detailRouter);
groupsRouter.use(actionsRouter);
groupsRouter.use(membersRouter);
groupsRouter.use(tasksRouter);
