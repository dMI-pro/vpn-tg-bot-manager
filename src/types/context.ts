import { Context, Scenes } from 'telegraf';

export interface MyWizardSession extends Scenes.WizardSessionData {
  vpsData?: {
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
  };
  configData?: {
    vpsId?: number;
    deviceName?: string;
    privateKey?: string;
    publicKey?: string;
    assignedIp?: string;
  };
}

export interface MyContext extends Context {
  scene: Scenes.SceneContextScene<MyContext, MyWizardSession>;
  wizard: Scenes.WizardContextWizard<MyContext>;
}
