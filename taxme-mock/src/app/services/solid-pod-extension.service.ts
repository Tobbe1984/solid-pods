import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environment';

@Injectable({
  providedIn: 'root',
})
export class SolidPodExtensionService {
  constructor() {}

  requestData(description: string, category: string, requestId: string, requesterWebId?: string): Observable<any> {
    return new Observable((observer) => {
      // @ts-ignore
      chrome.runtime.sendMessage(
        environment.EXTENSION_ID,
        {
          type: 'DATA_REQUEST',
          description,
          category,
          requestId,
          requesterWebId: requesterWebId ?? null,
        },
        (response: any) => {
          observer.next(response);
          observer.complete();
        },
      );
    });
  }

  getApproval(requestId: string): Observable<any> {
    return new Observable((observer) => {
      // @ts-ignore
      chrome.runtime.sendMessage(
        environment.EXTENSION_ID,
        { type: 'GET_APPROVAL', requestId },
        (response: any) => {
          observer.next(response ?? { pending: true });
          observer.complete();
        },
      );
    });
  }
}
