# Guthwine Chaos Mesh Experiments

This directory contains Chaos Mesh Custom Resource Definitions (CRDs) for testing the resilience of the Guthwine system under various failure conditions.

## Prerequisites

1. **Install Chaos Mesh** (v2.6.0+):
   ```bash
   kubectl apply -f https://mirrors.chaos-mesh.org/v2.6.0/install.yaml
   ```

2. **Label the target namespace**:
   ```bash
   kubectl label ns production chaos-mesh=enabled
   ```

3. **Verify installation**:
   ```bash
   kubectl get pods -n chaos-mesh
   ```

## Experiment Categories

### Network Chaos (`network-chaos.yaml`)

| Experiment | Description | Duration |
|------------|-------------|----------|
| `ws-latency-spike` | 250ms latency on WebSocket server | 60s |
| `neo4j-partition` | Network partition between API and Neo4j | 30s |
| `packet-loss-test` | 25% packet loss | 120s |
| `bandwidth-throttle` | 1 Mbps bandwidth limit | 300s |
| `dns-failure` | DNS resolution failures | 60s |

### Pod Chaos (`pod-chaos.yaml`)

| Experiment | Description | Target |
|------------|-------------|--------|
| `neo4j-leader-kill` | Kill Neo4j leader pod | Neo4j |
| `api-pod-kill` | Kill API pod (scheduled) | API |
| `redis-master-kill` | Kill Redis master | Redis |
| `container-kill` | Kill container (not pod) | API |
| `pod-failure-loop` | Simulate crash loop | API |
| `cpu-stress` | 80% CPU load | API |
| `memory-stress` | 512MB memory allocation | API |
| `io-latency` | 100ms I/O latency | Neo4j |

### Workflows (`workflow.yaml`)

| Workflow | Description | Duration |
|----------|-------------|----------|
| `cascading-failure-test` | Network degradation → Pod failure → Recovery | 10m |
| `database-failover-test` | Database failure → Degradation → Recovery | 15m |
| `rolling-restart-chaos` | Sequential pod kills with health monitoring | 10m |
| `multi-layer-stress` | CPU + Memory + Network stress simultaneously | 10m |

## Usage

### Apply Individual Experiments

```bash
# Apply network chaos
kubectl apply -f network-chaos.yaml

# Apply pod chaos
kubectl apply -f pod-chaos.yaml

# Apply workflows
kubectl apply -f workflow.yaml
```

### Run a Specific Experiment

```bash
# Start the cascading failure test
kubectl apply -f - <<EOF
apiVersion: chaos-mesh.org/v1alpha1
kind: Workflow
metadata:
  name: cascading-failure-test
  namespace: production
spec:
  entry: cascading-entry
  # ... (copy from workflow.yaml)
EOF
```

### Monitor Experiments

```bash
# List all chaos experiments
kubectl get networkchaos,podchaos,stresschaos,iochaos,dnschaos -n production

# Watch workflow progress
kubectl get workflow -n production -w

# Get experiment details
kubectl describe networkchaos ws-latency-spike -n production
```

### Stop/Delete Experiments

```bash
# Delete specific experiment
kubectl delete networkchaos ws-latency-spike -n production

# Delete all chaos experiments
kubectl delete networkchaos,podchaos,stresschaos,iochaos,dnschaos --all -n production

# Delete all workflows
kubectl delete workflow --all -n production
```

## Chaos Dashboard

Access the Chaos Mesh dashboard:

```bash
kubectl port-forward -n chaos-mesh svc/chaos-dashboard 2333:2333
```

Then open http://localhost:2333 in your browser.

## Safety Guidelines

1. **Never run in production without approval** - These experiments can cause service disruption
2. **Start with short durations** - Increase duration after validating recovery
3. **Monitor during experiments** - Watch metrics and logs
4. **Have rollback ready** - Know how to quickly delete experiments
5. **Test in staging first** - Validate experiments before production

## Hypothesis Testing

Each experiment should test a specific hypothesis:

| Hypothesis | Experiment | Expected Outcome |
|------------|------------|------------------|
| WebSocket reconnects within 5s | `ws-latency-spike` | Clients reconnect automatically |
| API degrades gracefully | `neo4j-partition` | Returns cached data or 503 |
| No data loss on pod restart | `api-pod-kill` | All transactions preserved |
| Leader election < 30s | `neo4j-leader-kill` | New leader elected, service resumes |
| Service survives 80% CPU | `cpu-stress` | Latency increases but no failures |

## Integration with CI/CD

Add chaos experiments to your CI/CD pipeline:

```yaml
# .github/workflows/chaos.yml
name: Chaos Testing
on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM

jobs:
  chaos:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Chaos Experiments
        run: |
          kubectl apply -f deploy/chaos-mesh/network-chaos.yaml
          sleep 300
          kubectl delete -f deploy/chaos-mesh/network-chaos.yaml
```

## Metrics to Monitor

During chaos experiments, monitor:

- **Latency**: p50, p95, p99 response times
- **Error rate**: 4xx and 5xx responses
- **Throughput**: Requests per second
- **Recovery time**: Time to return to baseline
- **Data integrity**: No data loss or corruption

## Troubleshooting

### Experiment not starting
```bash
kubectl describe <chaos-type> <experiment-name> -n production
```

### Pods not being targeted
```bash
# Verify selector matches pods
kubectl get pods -n production -l app=guthwine-api
```

### Workflow stuck
```bash
# Check workflow status
kubectl get workflow <workflow-name> -n production -o yaml
```
