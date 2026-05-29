import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Taxme } from './taxme';

describe('Taxme', () => {
  let component: Taxme;
  let fixture: ComponentFixture<Taxme>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Taxme],
    }).compileComponents();

    fixture = TestBed.createComponent(Taxme);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
