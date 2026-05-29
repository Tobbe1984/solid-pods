import { Component } from '@angular/core';
import {environment} from '../../../../environment';

@Component({
  selector: 'app-bekb',
  imports: [],
  templateUrl: './bekb.html',
  styleUrl: './bekb.scss',
})
export class Bekb {
  protected grantAccessToSolidPod() {
    // @ts-ignore
    chrome.runtime.sendMessage(environment.EXTENSION_ID,
      {
        type:        'DATA_REQUEST',
        description: 'Kontoauszüge des Jahres 2025 für Zwick, David',
        category:    'finance',
        requestId:   'test-001'
      },
      (response: any) => console.log(response)
    );
  }
}
