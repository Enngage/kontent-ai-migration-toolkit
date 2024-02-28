import { ManagementClient, SharedModels, WorkflowModels } from '@kontent-ai/management-sdk';
import { logErrorAndExit, IMigrationItem, Log } from '../../core/index.js';
import colors from 'colors';

export function getImportWorkflowHelper(log?: Log): ImportWorkflowHelper {
    return new ImportWorkflowHelper(log);
}

export class ImportWorkflowHelper {
    constructor(private readonly log?: Log) {}

    getWorkflowByCodename(workflowCodename: string, workflows: WorkflowModels.Workflow[]): WorkflowModels.Workflow {
        const workflow = workflows.find((m) => m.codename?.toLowerCase() === workflowCodename.toLowerCase());

        if (!workflow) {
            const errorMessages: string[] = [
                `Workflow with codename '${colors.red(workflowCodename)}' does not exist in target project`,
                `Available workflows are (${workflows.length}): ${workflows
                    .map((m) => colors.cyan(m.codename))
                    .join(', ')}`
            ];

            throw Error(errorMessages.join('. '));
        }

        return workflow;
    }

    async setWorkflowOfLanguageVariantAsync(
        managementClient: ManagementClient,
        workflowCodename: string,
        workflowStepCodename: string,
        importContentItem: IMigrationItem,
        workflows: WorkflowModels.Workflow[]
    ): Promise<void> {
        const workflow = this.getWorkflowByCodename(workflowCodename, workflows);

        // check if workflow step exists in target project
        if (!this.doesWorkflowStepExist(workflowCodename, workflowStepCodename, workflows)) {
            logErrorAndExit({
                message: `Could not change workflow step for item '${colors.yellow(
                    importContentItem.system.codename
                )}' because step with codename '${colors.red(workflowStepCodename)}' does not exist`
            });
        }

        if (this.doesWorkflowStepCodenameRepresentPublishedStep(workflowStepCodename, workflows)) {
            this.log?.({
                type: 'publish',
                message: `${importContentItem.system.name}`
            });

            await managementClient
                .publishLanguageVariant()
                .byItemCodename(importContentItem.system.codename)
                .byLanguageCodename(importContentItem.system.language)
                .withoutData()
                .toPromise();
        } else if (this.doesWorkflowStepCodenameRepresentScheduledStep(workflowStepCodename, workflows)) {
            this.log?.({
                type: 'skip',
                message: `Skipping scheduled workflow step for item '${colors.yellow(importContentItem.system.name)}'`
            });
        } else if (this.doesWorkflowStepCodenameRepresentArchivedStep(workflowStepCodename, workflows)) {
            // unpublish the language variant first if published
            // there is no way to determine if language variant is published via MAPI
            // so we have to always try unpublishing first and catching possible errors
            try {
                this.log?.({
                    type: 'unpublish',
                    message: `${importContentItem.system.name}`
                });

                await managementClient
                    .unpublishLanguageVariant()
                    .byItemCodename(importContentItem.system.codename)
                    .byLanguageCodename(importContentItem.system.language)
                    .withoutData()
                    .toPromise();
            } catch (error) {
                if (error instanceof SharedModels.ContentManagementBaseKontentError) {
                    this.log?.({
                        type: 'unpublish',
                        message: `Unpublish failed, but this may be expected behavior as we cannot determine if there is a published version already. Error received: ${error.message}`
                    });
                } else {
                    throw error;
                }
            }

            this.log?.({
                type: 'archive',
                message: `${importContentItem.system.name}`
            });

            await managementClient
                .changeWorkflowOfLanguageVariant()
                .byItemCodename(importContentItem.system.codename)
                .byLanguageCodename(importContentItem.system.language)
                .withData({
                    step_identifier: {
                        codename: workflow.archivedStep.codename
                    },
                    workflow_identifier: {
                        codename: workflow.codename
                    }
                })
                .toPromise();
        } else {
            if (workflow.codename === workflowStepCodename) {
                // item is already in the target workflow step
            } else {
                this.log?.({
                    type: 'changeWorkflowStep',
                    message: `${importContentItem.system.name}`
                });

                await managementClient
                    .changeWorkflowOfLanguageVariant()
                    .byItemCodename(importContentItem.system.codename)
                    .byLanguageCodename(importContentItem.system.language)
                    .withData({
                        step_identifier: {
                            codename: importContentItem.system.workflow_step
                        },
                        workflow_identifier: {
                            codename: workflow.codename
                        }
                    })
                    .toPromise();
            }
        }
    }

    private doesWorkflowStepCodenameRepresentPublishedStep(
        stepCodename: string,
        workflows: WorkflowModels.Workflow[]
    ): boolean {
        for (const workflow of workflows) {
            if (workflow.publishedStep.codename === stepCodename) {
                return true;
            }
        }

        return false;
    }

    private doesWorkflowStepCodenameRepresentArchivedStep(
        workflowStepCodename: string,
        workflows: WorkflowModels.Workflow[]
    ): boolean {
        for (const workflow of workflows) {
            if (workflow.archivedStep.codename === workflowStepCodename) {
                return true;
            }
        }

        return false;
    }

    private doesWorkflowStepCodenameRepresentScheduledStep(
        stepCodename: string,
        workflows: WorkflowModels.Workflow[]
    ): boolean {
        for (const workflow of workflows) {
            if (workflow.scheduledStep.codename === stepCodename) {
                return true;
            }
        }

        return false;
    }

    private doesWorkflowStepExist(
        workflowCodename: string,
        stepCodename: string,
        workflows: WorkflowModels.Workflow[]
    ): boolean {
        const workflow = this.getWorkflowByCodename(workflowCodename, workflows);

        if (workflow.archivedStep.codename === stepCodename) {
            return true;
        }
        if (workflow.publishedStep.codename === stepCodename) {
            return true;
        }
        if (workflow.scheduledStep.codename === stepCodename) {
            return true;
        }
        const step = workflow.steps.find((m) => m.codename === stepCodename);

        if (step) {
            return true;
        }

        return false;
    }
}
