import { Context, Scenes } from 'telegraf';

export interface MyWizardSession extends Scenes.WizardSessionData {
  vpsData?: {
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
  };
}

export interface MyContext extends Context {
  scene: Scenes.SceneContextScene<MyContext, MyWizardSession>;
  wizard: Scenes.WizardContextWizard<MyContext>;
}
