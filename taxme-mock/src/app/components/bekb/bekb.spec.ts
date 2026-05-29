import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Bekb } from './bekb';

describe('Bekb', () => {
  let component: Bekb;
  let fixture: ComponentFixture<Bekb>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Bekb],
    }).compileComponents();

    fixture = TestBed.createComponent(Bekb);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
